// handlers/threads.js
// 直接在 bot 裡抓 Threads 貼文（支援純文字/單圖/單影片/多圖/多影片/圖文影片混合）。
//
// 做法：
//   1. 用「完整瀏覽器 headers」打 threads.com SSR，拿到含有 data-sjs 完整 JSON 區塊的 HTML。
//      （精簡 headers 只會回 ~260KB 的頁面，缺少 video_versions / image_versions2 / carousel_media）。
//   2. 從 <script type="application/json" data-sjs> 裡定位貼文主物件，抽出媒體清單：
//      - carousel_media 陣列存在 → 逐項抽 image 或 video
//      - 否則 → 頂層 image_versions2 / video_versions 視為單一媒體
//   3. 純圖片貼文：前 4 張用同 URL 多 embed 合併成單一 embed 的圖片網格（不需下載）；
//      第 5 張起、以及所有影片與含影片貼文的圖片，下載後當附件上傳（影片原生播放）。
//   4. 超過 10 個附件時分批經由 additionalMessages 回傳，由 messageCreate 逐條送出。
//
// 回傳格式：
//   { type:'embed', embed, embeds?, files, originalUrl, additionalMessages? }

const { AttachmentBuilder, EmbedBuilder } = require('discord.js');

const FETCH_TIMEOUT = 20000;
const FETCH_MEDIA_TIMEOUT = 25000;
const THREADS_POST_RE = /^\/@([A-Za-z0-9._]+)\/post\/([A-Za-z0-9_-]+)\/?(?:\?.*)?$/;

// embed 顏色依貼文類型區分
const THREADS_COLORS = {
    text:  0x1A1A1A, // 純文字：Threads 黑
    image: 0x0095F6, // 圖片貼文：藍
    video: 0xE1306C, // 影片貼文：桃紅
    mixed: 0x8A3AB9, // 圖片 + 影片混合：紫
    poll:  0xFEE75C, // 投票貼文：黃
};
const MAX_ATTACH_PER_MSG = 10;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // Discord 未加成伺服器的上限 10MB，超過立即中斷下載
// 媒體平行下載數，可透過環境變數 THREADS_MAX_PARALLEL_MEDIA 調整
const MAX_PARALLEL_MEDIA = Math.min(10, Math.max(1, parseInt(process.env.THREADS_MAX_PARALLEL_MEDIA, 10) || 6));

// 重點：少了 Accept (含 image/webp) 與 Sec-Fetch-*、Accept-Encoding:br 會讓 Threads 只回精簡頁
const BROWSER_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7',
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Ch-Ua': '"Chromium";v="125", "Not.A/Brand";v="24"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
};

// -------------------- helpers --------------------

function htmlDecode(s) {
    if (!s) return '';
    return String(s)
        .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
        .replace(/&#(\d+);/g,          (_, d) => String.fromCodePoint(parseInt(d, 10)))
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#039;|&#x27;/g, "'");
}

function jstr(s) {
    if (s == null) return '';
    try { return JSON.parse('"' + s + '"'); } catch { return String(s); }
}

function pickMeta(html, prop) {
    const esc = prop.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
    const m = html.match(new RegExp(
        `<meta\\s+[^>]*?(?:property|name)=["']${esc}["'][^>]*?content=["']([^"']+)["']`, 'i'
    ));
    return m ? htmlDecode(m[1]) : null;
}

function extractSjsChunks(html) {
    const out = [];
    // 屬性之間可能有多個空白；直接用 [^>]*data-sjs 繞過
    const re = /<script[^>]*type=["']application\/json["'][^>]*\bdata-sjs\b[^>]*>([\s\S]*?)<\/script>/g;
    let m;
    while ((m = re.exec(html)) !== null) out.push(m[1]);
    return out;
}

// 從 text[startIdx] 開始的位置找成對 bracket 區間（startIdx 指在 openC 或其後皆可）
function balancedBlock(text, startIdx, openC, closeC) {
    let depth = 0, s = -1, i = startIdx, inStr = false, esc = false;
    while (i < text.length) {
        const ch = text[i];
        if (inStr) {
            if (esc) esc = false;
            else if (ch === '\\') esc = true;
            else if (ch === '"') inStr = false;
        } else {
            if (ch === '"') inStr = true;
            else if (ch === openC) { if (depth === 0) s = i; depth++; }
            else if (ch === closeC) {
                depth--;
                if (depth === 0) return [s, i + 1];
            }
        }
        i++;
    }
    return null;
}

function splitObjects(s) {
    const out = [];
    let depth = 0, start = -1, inStr = false, esc = false;
    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (inStr) {
            if (esc) esc = false;
            else if (ch === '\\') esc = true;
            else if (ch === '"') inStr = false;
        } else {
            if (ch === '"') inStr = true;
            else if (ch === '{') { if (depth === 0) start = i; depth++; }
            else if (ch === '}') {
                depth--;
                if (depth === 0 && start >= 0) { out.push(s.slice(start, i+1)); start = -1; }
            }
        }
    }
    return out;
}

// 從一個 post/carousel item 物件取媒體（物件必須是已 parse 好的 JS 物件）
function extractMediaFromObj(o) {
    if (!o || typeof o !== 'object') return null;
    const ent = {};
    if (Array.isArray(o.video_versions) && o.video_versions.length) {
        let best = o.video_versions[0];
        for (const v of o.video_versions) {
            if ((v.width || 0) > (best.width || 0)) best = v;
        }
        if (best && best.url) ent.video = best.url;
    }
    const iv2 = o.image_versions2;
    if (iv2 && Array.isArray(iv2.candidates) && iv2.candidates.length) {
        let best = iv2.candidates[0];
        for (const c of iv2.candidates) {
            if ((c.width || 0) > (best.width || 0)) best = c;
        }
        if (best && best.url) ent.image = best.url;
    }
    return (ent.image || ent.video) ? ent : null;
}

function extractMedia(obj) {
    const items = [];
    if (!obj || typeof obj !== 'object') return items;

    // carousel_media 存在時，以 carousel 項目為準；頂層 image/video 常是第一個項目的重複預覽。
    // 只有 carousel 抽不到任何項目時，才退回頂層媒體。
    if (Array.isArray(obj.carousel_media) && obj.carousel_media.length) {
        for (const c of obj.carousel_media) {
            const e = extractMediaFromObj(c);
            if (e) items.push(e);
        }
        if (items.length) return items;
    }

    // Threads 也可能把轉貼 / link preview 的影片放在 text_post_app_info.linked_inline_media
    // （例如單影片分享文）。這是貼文本身的媒體，不應該退回掃整個 chunk，否則會抓到留言媒體。
    // 形狀可能是單一物件或陣列，兩種都處理。
    const linked = obj.text_post_app_info && obj.text_post_app_info.linked_inline_media;
    for (const l of Array.isArray(linked) ? linked : [linked]) {
        const e = extractMediaFromObj(l);
        if (e) items.push(e);
    }

    const top = extractMediaFromObj(obj);
    if (top) items.push(top);
    return items;
}

function findPostObject(chunks, shortcode) {
    const codeNeedle = `"code":"${shortcode}"`;
    const hasMediaMarkers = c => c.includes('image_versions2')
        || c.includes('carousel_media')
        || c.includes('video_versions');
    const mediaScore = c => (c.match(/video_versions/g) || []).length
        + (c.match(/carousel_media/g) || []).length
        + (c.match(/image_versions2/g) || []).length;
    const objScore = o => {
        if (!o || typeof o !== 'object') return 0;
        let score = 0;
        const media = extractMedia(o);
        if (media.length) score += 100 + media.length;
        if (o.caption && typeof o.caption.text === 'string') score += 50;
        const u = o.user || o.owner;
        if (u && typeof u.profile_pic_url === 'string') score += 10;
        if (o.code === shortcode) score += 5;
        return score;
    };

    function blocksAroundCode(target) {
        const out = [];
        const seenStarts = new Set();
        let from = 0, at;
        while ((at = target.indexOf(codeNeedle, from)) !== -1) {
            from = at + codeNeedle.length;
            let tried = 0;
            for (let i = at; i >= 0 && tried < 160; i--) {
                if (target[i] !== '{') continue;
                tried++;
                if (seenStarts.has(i)) continue;
                const blk = balancedBlock(target, i, '{', '}');
                if (!blk) continue;
                const text = target.slice(blk[0], blk[1]);
                if (!text.includes(codeNeedle)) continue;
                seenStarts.add(i);
                out.push({ start: i, text });
            }
        }
        // 從最小的候選物件開始；通常最小且含 code 的可解析區塊就是貼文主物件。
        return out.sort((a, b) => a.text.length - b.text.length || a.start - b.start);
    }

    function regexExtractMedia(target) {
        const media = [];

        // carousel_media
        const carRe = /"carousel_media":\[/g;
        let cm;
        while ((cm = carRe.exec(target)) !== null) {
            const p = cm.index + cm[0].length - 1; // 指在 '['
            const blk = balancedBlock(target, p, '[', ']');
            if (!blk) continue;
            const inner = target.slice(blk[0]+1, blk[1]-1);
            for (const os of splitObjects(inner)) {
                let o; try { o = JSON.parse(os); } catch { continue; }
                const e = extractMediaFromObj(o); if (e) media.push(e);
            }
        }
        // 頂層 video_versions（小心別重複抓 carousel 內的）
        const vidRe = /"video_versions":\[/g;
        let vm;
        while ((vm = vidRe.exec(target)) !== null) {
            const before = target.slice(Math.max(0, vm.index - 40), vm.index);
            if (before.includes('carousel_media')) continue; // 已在上面處理
            const blk = balancedBlock(target, vm.index + vm[0].length - 1, '[', ']');
            if (!blk) continue;
            const arr = target.slice(blk[0]+1, blk[1]-1);
            const u = arr.match(/"url":"((?:https?:)?\\\/\\\/[^"]+?\.mp4[^"]*)"/);
            if (u) {
                const url = jstr(u[1]);
                if (!media.some(x => x.video === url)) media.unshift({ video: url });
            }
        }
        // 頂層 image_versions2（僅當前沒有任何媒體時補一個）
        if (media.length === 0) {
            const imgRe = /"image_versions2":\{"candidates":\[/;
            const im = imgRe.exec(target);
            if (im) {
                const blk = balancedBlock(target, im.index + im[0].length - 1, '[', ']');
                if (blk) {
                    const arr = target.slice(blk[0]+1, blk[1]-1);
                    const u = arr.match(/"url":"((?:https?:)?\\\/\\\/[^"]+?\.(?:jpg|jpeg|png|webp)[^"]*)"/);
                    if (u) media.push({ image: jstr(u[1]) });
                }
            }
        }

        return media;
    }

    // 1) 同一個 shortcode 可能出現在多個 data-sjs chunk（SEO / route / analytics / full post）。
    //    不可直接取第一個；要掃過所有含 shortcode 的 chunk，並優先檢查媒體特徵較完整者。
    const exactChunks = chunks.filter(ch => ch.includes(codeNeedle));
    const exactTargets = exactChunks
        .map((ch, order) => ({ ch, order, score: mediaScore(ch) }))
        .sort((a, b) => b.score - a.score || a.order - b.order)
        .map(x => x.ch);

    let bestMatchedObj = null;
    let bestScore = -1;

    for (const target of exactTargets) {
        // 由小到大逐塊 parse，命中媒體立即返回，避免先把大型祖先 wrapper 全部 parse 完
        for (const block of blocksAroundCode(target)) {
            let obj;
            try { obj = JSON.parse(block.text); }
            catch { continue; /* malformed / non-standalone JSON object */ }
            const score = objScore(obj);
            if (score > bestScore) { bestScore = score; bestMatchedObj = obj; }
            const media = extractMedia(obj);
            if (media.length > 0) return { obj, media };
        }
    }

    // 如果已經成功 parse 到目標貼文物件，但 extractMedia 沒抽出媒體，
    // 就視為純文字 / 投票 / 不支援的 attachment；不要再掃 wrapper，避免抓到留言媒體。
    if (bestMatchedObj && bestMatchedObj.code === shortcode) return { obj: bestMatchedObj, media: [] };

    // 2) 如果 JSON.parse 沒抓到完整 post object，但含 shortcode 的 chunk 有媒體標記，
    //    才在「含 shortcode 的 chunks」內做 regex fallback；避免掃到頁面其他無關媒體。
    for (const target of exactTargets) {
        if (!hasMediaMarkers(target)) continue;
        const blocks = blocksAroundCode(target);
        const postLikeBlocks = blocks.filter(b =>
            b.text.includes('"caption"') || b.text.includes('"text_post_app_info"') || b.text.includes('"media_type"')
        );
        for (const block of (postLikeBlocks.length ? postLikeBlocks : blocks)) {
            const media = regexExtractMedia(block.text);
            if (media.length > 0) return { obj: bestMatchedObj, media };
        }
    }

    // 3) 只要頁面內有 shortcode，就不要退回掃全頁其他媒體。
    //    這通常代表純文字貼文，或 Threads JSON 結構變動導致無法解析媒體。
    if (exactChunks.length > 0) return { obj: bestMatchedObj, media: [] };

    // 4) 極端 fallback：完全找不到 shortcode 時，維持舊行為，挑媒體特徵最多的 chunk 掃描。
    const fallbackTarget = chunks.reduce((a, b) => mediaScore(b) > mediaScore(a || '') ? b : a, null);
    if (!fallbackTarget) return null;
    return { obj: null, media: regexExtractMedia(fallbackTarget) };
}

async function fetchMedia(url, kind) {
    const controller = new AbortController();
    // timer 移到 finally 才清除，讓 timeout 涵蓋整個 body 下載，不只等到 headers
    const timer = setTimeout(() => controller.abort(), FETCH_MEDIA_TIMEOUT);
    try {
        const resp = await fetch(url, {
            headers: {
                'User-Agent': BROWSER_HEADERS['User-Agent'],
                'Referer': 'https://www.threads.com/',
                'Accept': kind === 'video' ? 'video/*,*/*' : 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
                'Accept-Language': BROWSER_HEADERS['Accept-Language'],
            },
            signal: controller.signal,
        });
        if (!resp.ok || !resp.body) return null;

        // 下載前先用 Content-Length 擋掉明顯過大的檔案
        const declared = parseInt(resp.headers.get('content-length') || '', 10);
        if (Number.isFinite(declared) && declared > MAX_FILE_SIZE) {
            controller.abort();
            return { tooBig: true, bufLen: declared };
        }

        // streaming 逐塊累積，一超過上限立即 abort，不把整個檔案抓完
        const parts = [];
        let total = 0;
        for await (const chunk of resp.body) {
            total += chunk.length;
            if (total > MAX_FILE_SIZE) {
                controller.abort();
                return { tooBig: true, bufLen: total };
            }
            parts.push(chunk);
        }
        return { buf: Buffer.concat(parts) };
    } catch (e) {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

async function limitParallel(tasks, limit) {
    const results = new Array(tasks.length);
    let idx = 0;
    async function worker() {
        while (true) {
            const i = idx++;
            if (i >= tasks.length) return;
            results[i] = await tasks[i]();
        }
    }
    await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, () => worker()));
    return results;
}

function extFromUrl(url, kind) {
    if (kind === 'video') return '.mp4';
    const m = url.match(/\.(jpg|jpeg|png|webp|gif)(\?|$)/i);
    return m ? '.' + m[1].toLowerCase() : '.jpg';
}

// 找貼文作者的頭像網址：優先從已解析的貼文物件，再退回從 HTML 掃描該使用者的 profile_pic_url
function findProfilePic(obj, html, username) {
    if (obj) {
        const u = obj.user || obj.owner;
        if (u && typeof u.profile_pic_url === 'string' && u.profile_pic_url) return u.profile_pic_url;
    }
    const esc = username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    let m = html.match(new RegExp(`"username":"${esc}"[^{}]*?"profile_pic_url":"((?:[^"\\\\]|\\\\.)+)"`));
    if (!m) m = html.match(new RegExp(`"profile_pic_url":"((?:[^"\\\\]|\\\\.)+)"[^{}]*?"username":"${esc}"`));
    return m ? jstr(m[1]) : null;
}

function extractPoll(obj) {
    const poll = obj && obj.caption_add_on && obj.caption_add_on.poll;
    if (!poll || !Array.isArray(poll.tallies) || poll.tallies.length === 0) return null;
    const tallies = poll.tallies
        .filter(t => t && typeof t.text === 'string')
        .map(t => ({ text: t.text, count: Number(t.count) || 0 }));
    if (!tallies.length) return null;
    return {
        tallies,
        total: tallies.reduce((sum, t) => sum + t.count, 0),
        max: Math.max(...tallies.map(t => t.count), 0),
        finished: poll.finished === true,
        expiresAt: Number.isFinite(Number(poll.expires_at)) ? Number(poll.expires_at) : null,
        viewerCanVote: poll.viewer_can_vote === true,
    };
}

function escapeEmbedText(s) {
    // embed field 會渲染 masked link，[ ] 也要跳脫，避免選項文字注入連結
    return String(s || '')
        .replace(/\\/g, '\\\\')
        .replace(/([*_`~|[\]])/g, '\\$1')
        .replace(/</g, '‹')
        .replace(/>/g, '›');
}

function formatPollField(poll) {
    if (!poll) return null;
    const barWidth = 12;
    const fmt = n => Number(n || 0).toLocaleString('en-US');
    const lines = poll.tallies.map((t, idx) => {
        const pct = poll.total > 0 ? (t.count / poll.total) * 100 : 0;
        // 0 票不畫實心格，避免看起來像有票
        const fill = (t.count > 0 && poll.max > 0) ? Math.max(1, Math.round((t.count / poll.max) * barWidth)) : 0;
        const bar = '█'.repeat(fill) + '░'.repeat(barWidth - fill);
        return `${idx + 1}. **${escapeEmbedText(t.text)}**\n   \`${bar}\` **${pct.toFixed(1)}%** · ${fmt(t.count)} 票`;
    });
    const meta = [`共 **${fmt(poll.total)}** 票`];
    if (poll.finished) meta.push('已結束');
    else if (poll.expiresAt) meta.push(`結束時間 <t:${Math.floor(poll.expiresAt)}:R>`);
    else if (poll.viewerCanVote) meta.push('仍可投票');

    // Discord field value 上限 1024；以「整個選項」為單位截斷，
    // 避免切在 markdown 標記或 emoji surrogate pair 中間
    const metaLine = meta.join(' • ');
    let value = `${lines.join('\n')}\n\n${metaLine}`;
    if (value.length > 1024) {
        const kept = [];
        let used = metaLine.length + 4; // '\n…\n\n' + metaLine
        for (const line of lines) {
            if (used + line.length + 1 > 1024) break;
            kept.push(line);
            used += line.length + 1;
        }
        value = `${kept.join('\n')}\n…\n\n${metaLine}`;
    }
    return {
        name: poll.finished ? '📊 投票結果' : '📊 投票',
        value,
    };
}

// -------------------- main --------------------

module.exports = {
    name: 'threads',

    match(hostname) {
        return hostname === 'threads.net' || hostname === 'www.threads.net'
            || hostname === 'threads.com' || hostname === 'www.threads.com';
    },

    async resolve(url) {
        let parsed;
        try { parsed = new URL(url); } catch { return null; }
        const m = parsed.pathname.match(THREADS_POST_RE);
        if (!m) return null;
        const [, usernameFromUrl, postCode] = m;
        const cleanUrl = `https://www.threads.com/@${usernameFromUrl}/post/${postCode}`;

        let html;
        const c = new AbortController();
        // timer 在 finally 才清除，讓 timeout 涵蓋 HTML body 的完整下載
        const t = setTimeout(() => c.abort(), FETCH_TIMEOUT);
        try {
            const resp = await fetch(cleanUrl, {
                headers: BROWSER_HEADERS,
                redirect: 'follow',
                signal: c.signal,
            });
            if (!resp.ok) return null;
            const finalUrl = resp.url || '';
            // 被重導向到 ?error=invalid_post：貼文不存在或已刪除，回覆使用者
            if (finalUrl.includes('error=invalid_post')) {
                return { type: 'notice', message: '網址錯誤或脆文已刪除' };
            }
            if (finalUrl.includes('error=') || finalUrl.includes('/login')) return null;
            html = await resp.text();
        } catch (err) {
            console.warn('[threads] fetch 失敗：', err.message);
            return null;
        } finally {
            clearTimeout(t);
        }

        const ogTitle = pickMeta(html, 'og:title') || '';
        const ogDesc  = pickMeta(html, 'og:description') || '';
        const ogImage = pickMeta(html, 'og:image') || null;

        // 作者 / 顯示名
        let username = usernameFromUrl;
        const atM = ogTitle.match(/[@＠]([A-Za-z0-9._]+)/);
        if (atM) username = atM[1];
        let dn = ogTitle
            .replace(/[（(]\s*[@＠][A-Za-z0-9._]+\s*[)）]/g, '')
            .replace(/\s*on\s+Threads\.?$/i, '')
            .replace(/^Threads\s*(?:上的|的)?\s*/, '')
            .trim();
        const displayName = dn || `@${username}`;

        // 媒體（純文字貼文不把 og:image 當成貼文圖片——那只是自動產生的預覽卡，不是內容）
        const chunks = extractSjsChunks(html);
        const found = findPostObject(chunks, postCode);
        let media = (found && found.media) || [];

        // 去重
        const seen = new Set();
        media = media.filter(it => {
            const k = it.video || it.image;
            if (!k || seen.has(k)) return false;
            seen.add(k);
            return true;
        });

        // caption
        let caption = '';
        if (found && found.obj && found.obj.caption && typeof found.obj.caption.text === 'string') {
            caption = found.obj.caption.text;
        } else {
            const capRe = new RegExp(`"caption":\\{"text":"((?:[^"\\\\]|\\\\.){0,4000}?)","`);
            const cm2 = html.match(capRe);
            caption = cm2 ? jstr(cm2[1]) : ogDesc;
        }
        if (caption.length > 1900) caption = caption.slice(0, 1900) + '…';

        const poll = extractPoll(found && found.obj);
        const pollField = formatPollField(poll);

        // embed
        // 貼文類型 → 對應顏色（影片項目會同時帶封面圖，判斷以 video 優先）
        const hasVid = media.some(it => it.video);
        const hasImg = media.some(it => it.image && !it.video);
        const postType = poll ? 'poll' : (media.length === 0 ? 'text' : (hasVid && hasImg ? 'mixed' : hasVid ? 'video' : 'image'));

        // 作者頭像；無媒體貼文（純文字 / 投票）的 og:image 通常就是作者頭像，可作為備援。
        // 放在右上角 thumbnail，比 author icon 稍大且不會佔用大圖區。
        const profilePic = findProfilePic(found && found.obj, html, username)
            || (media.length === 0 ? ogImage : null);

        const imageItems = media.filter(it => it.image && !it.video);
        // 純圖片貼文：前 4 張放進 embed 圖片網格（同 URL 多 embed 合併，畫面上是同一個
        // embed、不需下載），第 5 張起才改用附件上傳；含影片時全部媒體都用附件。
        const embedImageUrls = !hasVid ? imageItems.slice(0, 4).map(it => it.image) : [];
        const uploadList = hasVid ? media : imageItems.slice(4);

        const embed = new EmbedBuilder()
            .setColor(THREADS_COLORS[postType])
            .setURL(cleanUrl)
            .setAuthor({ name: `${displayName} (@${username})`, url: cleanUrl });
        if (profilePic) embed.setThumbnail(profilePic);
        if (caption && caption.trim()) embed.setDescription(caption.trim());
        if (pollField) embed.addFields(pollField);

        // 媒體呈現規則：
        // - 純圖片：前 4 張進 embed 圖片網格（不上傳），第 5 張起改用附件。
        // - 只要含影片：embed 只放文字，影片與 standalone 圖片全部改用附件。
        // - 附件全數失敗時，退回把首張圖 / 影片封面放進 embed（見下方 fallback）。
        const attachments = [];
        const downloads = [];

        for (const it of uploadList) {
            if (it.video) {
                downloads.push({ kind: 'video', url: it.video, idx: attachments.length });
                attachments.push(null);
            } else if (it.image) {
                downloads.push({ kind: 'image', url: it.image, idx: attachments.length });
                attachments.push(null);
            }
        }

        let skippedBig = 0;
        let failedDownload = 0;
        if (downloads.length) {
            const results = await limitParallel(
                downloads.map(d => async () => ({ ...d, res: await fetchMedia(d.url, d.kind) })),
                MAX_PARALLEL_MEDIA
            );
            for (const r of results) {
                if (r.res && r.res.tooBig) { skippedBig++; attachments[r.idx] = null; continue; }
                if (!r.res) { failedDownload++; attachments[r.idx] = null; continue; }
                const fname = `${postCode}_${r.idx}${extFromUrl(r.url, r.kind)}`;
                attachments[r.idx] = new AttachmentBuilder(r.res.buf, { name: fname });
            }
        }
        const files = attachments.filter(Boolean);

        // 超過大小上限而未附上的媒體，在 footer 提示
        const sizeMB = Math.floor(MAX_FILE_SIZE / 1024 / 1024);
        const footerParts = ['Threads'];
        if (skippedBig > 0) footerParts.push(`${skippedBig} 個媒體超過 ${sizeMB}MB 未附上`);
        if (failedDownload > 0) footerParts.push(`${failedDownload} 個媒體下載失敗`);
        embed.setFooter({ text: footerParts.join(' • ') });

        // 前 4 張圖：用多個同 URL embed 呈現（Discord 會合併成單一 embed 的圖片網格）。
        const embeds = [embed];
        if (embedImageUrls.length > 0) {
            embed.setImage(embedImageUrls[0]);
            for (const imageUrl of embedImageUrls.slice(1)) {
                embeds.push(new EmbedBuilder()
                    .setColor(THREADS_COLORS[postType])
                    .setURL(cleanUrl)
                    .setImage(imageUrl));
            }
        } else if (downloads.length > 0 && files.length === 0) {
            // fallback：附件全數失敗或超限（例如影片超過 10MB）時，
            // 退回把首張圖 / 影片封面放進 embed，避免整則沒有任何視覺內容
            const firstImg = media.find(it => it.image);
            if (firstImg) embed.setImage(firstImg.image);
            else if (ogImage) embed.setImage(ogImage);
        }

        // 分批附件
        const mainFiles = files.slice(0, MAX_ATTACH_PER_MSG);
        const extraFiles = files.slice(MAX_ATTACH_PER_MSG);
        const additionalMessages = [];
        for (let i = 0; i < extraFiles.length; i += MAX_ATTACH_PER_MSG) {
            additionalMessages.push({
                content: i === 0 ? `📎 ${displayName} 的其他媒體：` : undefined,
                files: extraFiles.slice(i, i + MAX_ATTACH_PER_MSG),
            });
        }

        return {
            type: 'embed',
            embed: embed.toJSON(),
            embeds: embeds.map(e => e.toJSON()),
            files: mainFiles,
            additionalMessages,
            originalUrl: cleanUrl,
        };
    },
};