// handlers/threads.js
// 直接在 bot 裡抓 Threads 貼文（支援純文字/單圖/單影片/多圖/多影片/圖文影片混合/引用轉發）。
// 網址支援 /@user/post/<code> 與 App 分享短網址 /share/<id>（302 導向前者後照常解析）。
//
// 做法：
//   1. 用「完整瀏覽器 headers」打 threads.com SSR，拿到含有 data-sjs 完整 JSON 區塊的 HTML。
//      （精簡 headers 只會回 ~260KB 的頁面，缺少 video_versions / image_versions2 / carousel_media）。
//      redirect 逐跳手動追蹤：需登入的貼文會被 302 到 ?error=invalid_post，但 share 短網址
//      中途那一跳是真正的貼文網址，要先記下來才能在提示訊息附上「開啟原文」按鈕。
//   2. 從 <script type="application/json" data-sjs> 裡定位貼文主物件，抽出媒體清單：
//      - carousel_media 陣列存在 → 逐項抽 image 或 video
//      - 否則 → 頂層 image_versions2 / video_versions 視為單一媒體
//      - 引用轉發（quote post）：外層貼文的媒體欄位是 null，引用內容（含媒體）掛在
//        text_post_app_info.share_info.quoted_attachment_post，一併抽出。
//   3. 純圖片貼文：前 4 張用同 URL 多 embed 合併成單一 embed 的圖片網格（不需下載）；
//      第 5 張起、以及所有影片與含影片貼文的圖片，下載後當附件上傳（影片原生播放）。
//   4. 超過 10 個附件時分批經由 additionalMessages 回傳，由 messageCreate 逐條送出。
//
// 回傳格式：
//   { type:'embed', embed, embeds?, files, components?, originalUrl, additionalMessages? }
//   { type:'notice', message, components? }（貼文需登入 / 已刪除等提示）

const { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');

const FETCH_TIMEOUT = 20000;
const FETCH_MEDIA_TIMEOUT = 25000;
const MAX_REDIRECTS = 5;
const THREADS_POST_RE = /^\/@([A-Za-z0-9._]+)\/post\/([A-Za-z0-9_-]+)\/?(?:\?.*)?$/;
// 分享短網址（App 內「複製連結」產生）：/share/<id>，會 302 重導向到 /@user/post/<code>
const THREADS_SHARE_RE = /^\/share\/([A-Za-z0-9_-]+)\/?(?:\?.*)?$/;

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

function pickMeta(html, prop) {
    const esc = prop.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
    const m = html.match(new RegExp(
        `<meta\\s+[^>]*?(?:property|name)=["']${esc}["'][^>]*?content=["']([^"']+)["']`, 'i'
    ));
    return m ? htmlDecode(m[1]) : null;
}

function pickCanonical(html) {
    const tags = html.match(/<link\b[^>]*>/gi) || [];
    for (const tag of tags) {
        const rel = tag.match(/\brel=["']([^"']+)["']/i);
        if (!rel || !rel[1].split(/\s+/).some(v => v.toLowerCase() === 'canonical')) continue;
        const href = tag.match(/\bhref=["']([^"']+)["']/i);
        if (href) return htmlDecode(href[1]);
    }
    return null;
}

function threadsPostIdentity(value) {
    if (!value) return null;
    try {
        const parsed = new URL(htmlDecode(value), 'https://www.threads.com/');
        if (!/^www\.threads\.(?:com|net)$|^threads\.(?:com|net)$/i.test(parsed.hostname)) return null;
        const match = parsed.pathname.match(THREADS_POST_RE);
        return match ? { username: match[1].toLowerCase(), code: match[2] } : null;
    } catch {
        return null;
    }
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

function selectRichestMedia(objects) {
    let best = [];
    let bestRank = [-1, -1, -1];

    for (const obj of objects) {
        const media = extractMedia(obj);
        const videoCount = media.filter(item => item.video).length;
        const coveredCount = media.filter(item => item.image).length;
        // A video representation is richer than its image-only cover. For equal media
        // types, prefer the duplicate carrying more carousel/standalone items and covers.
        const rank = [videoCount, media.length, coveredCount];
        const richer = rank[0] > bestRank[0]
            || (rank[0] === bestRank[0] && rank[1] > bestRank[1])
            || (rank[0] === bestRank[0] && rank[1] === bestRank[1] && rank[2] > bestRank[2]);
        if (richer) {
            best = media;
            bestRank = rank;
        }
    }

    return best;
}

function findPostObject(chunks, shortcode, expectedUsername) {
    const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
    const objScore = o => {
        if (!o || typeof o !== 'object') return 0;
        let score = Object.keys(o).length;
        const media = extractMedia(o);
        if (media.length) score += 100 + media.length;
        if (o.caption && typeof o.caption.text === 'string') score += 50;
        if (extractPoll(o)) score += 40;
        const shareInfo = o.text_post_app_info && o.text_post_app_info.share_info;
        if (shareInfo && (shareInfo.quoted_attachment_post || shareInfo.quoted_post)) score += 40;
        const u = o.user || o.owner;
        if (u && typeof u.profile_pic_url === 'string') score += 10;
        return score;
    };

    const candidates = [];

    function collectExactObjects(root) {
        const stack = [root];
        const visited = new Set();

        while (stack.length) {
            const value = stack.pop();
            if (!value || typeof value !== 'object' || visited.has(value)) continue;
            visited.add(value);

            // A wrapper containing the target code is not the target post. Only a node
            // whose own `code` field matches may contribute caption, media, quote or poll data.
            if (!Array.isArray(value) && hasOwn(value, 'code') && value.code === shortcode) {
                candidates.push(value);
            }

            if (Array.isArray(value)) {
                for (let i = value.length - 1; i >= 0; i--) stack.push(value[i]);
            } else {
                for (const child of Object.values(value)) stack.push(child);
            }
        }
    }

    function blocksAroundCode(target) {
        const out = [];
        const seenStarts = new Set();
        const codePattern = new RegExp(`"code"\\s*:\\s*"${shortcode}"`, 'g');
        let match;
        while ((match = codePattern.exec(target)) !== null) {
            const at = match.index;
            let tried = 0;
            for (let i = at; i >= 0 && tried < 160; i--) {
                if (target[i] !== '{') continue;
                tried++;
                if (seenStarts.has(i)) continue;
                const blk = balancedBlock(target, i, '{', '}');
                if (!blk) continue;
                const text = target.slice(blk[0], blk[1]);
                seenStarts.add(i);
                out.push({ start: i, text });
            }
        }
        // 從最小的候選物件開始；通常最小且含 code 的可解析區塊就是貼文主物件。
        return out.sort((a, b) => a.text.length - b.text.length || a.start - b.start);
    }

    for (const chunk of chunks) {
        if (typeof chunk !== 'string' || !chunk.includes(shortcode)) continue;

        try {
            // The canonical post is not necessarily the first thread item and can itself
            // be a quoted or inline node nested below another post, so walk the full graph.
            collectExactObjects(JSON.parse(chunk));
            continue;
        } catch {
            // A malformed wrapper can still contain a standalone valid post object. This
            // fallback parses balanced objects, but the same own-code check is still applied.
        }

        for (const block of blocksAroundCode(chunk)) {
            try { collectExactObjects(JSON.parse(block.text)); }
            catch { /* not a standalone JSON object */ }
        }
    }

    // Textual proximity, an ancestor containing the code, and a media-heavy chunk are not
    // proof of ownership. If no exact node can be parsed, resolve() safely falls back to OG.
    if (!candidates.length) return null;

    const identities = {
        id: new Set(),
        pk: new Set(),
        username: new Set(),
    };
    for (const obj of candidates) {
        if (obj.id != null && String(obj.id)) identities.id.add(String(obj.id));
        if (obj.pk != null && String(obj.pk)) identities.pk.add(String(obj.pk));
        const user = obj.user || obj.owner;
        if (user && typeof user.username === 'string' && user.username) {
            identities.username.add(user.username.toLowerCase());
        }
    }

    const expected = String(expectedUsername || '').toLowerCase();
    const conflictingIdentity = identities.id.size > 1
        || identities.pk.size > 1
        || identities.username.size > 1;
    const wrongAuthor = expected && identities.username.size === 1
        && !identities.username.has(expected);
    if (conflictingIdentity || wrongAuthor) {
        return { obj: null, objects: [], media: [], ambiguous: true };
    }

    candidates.sort((a, b) => objScore(b) - objScore(a));
    const obj = candidates[0];
    return {
        obj,
        objects: candidates,
        media: selectRichestMedia(candidates),
        ambiguous: false,
    };
}

// 區分「私人帳號需登入」與「貼文已刪除」：
// 私人帳號的個人頁（threads.com/@username）會被 302 到 /login，公開帳號則正常載入。
// 回傳 'login' | 'public' | 'unknown'
async function checkProfileAccess(username) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
    try {
        const resp = await fetch(`https://www.threads.com/@${username}`, {
            headers: BROWSER_HEADERS,
            redirect: 'manual',
            signal: controller.signal,
        });
        if (resp.body) resp.body.cancel().catch(() => {});
        if (resp.status >= 300 && resp.status < 400) {
            const loc = resp.headers.get('location') || '';
            return loc.includes('/login') ? 'login' : 'unknown';
        }
        return resp.ok ? 'public' : 'unknown';
    } catch {
        return 'unknown';
    } finally {
        clearTimeout(timer);
    }
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

// 頭像也只信任已通過 exact-code 驗證的貼文物件；不可從整頁挑同名推薦資料。
function findProfilePic(obj) {
    if (!obj) return null;
    const u = obj.user || obj.owner;
    return u && typeof u.profile_pic_url === 'string' && u.profile_pic_url
        ? u.profile_pic_url
        : null;
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
        const shareM = m ? null : parsed.pathname.match(THREADS_SHARE_RE);
        if (!m && !shareM) return null;

        // share 短網址要等 302 重導向後才知道 username / postCode
        let usernameFromUrl = m ? m[1] : null;
        let postCode = m ? m[2] : null;
        let resolvedSharePost = false;
        const fetchUrl = m
            ? `https://www.threads.com/@${usernameFromUrl}/post/${postCode}`
            : `https://www.threads.com/share/${shareM[1]}/`;

        let html;
        let invalidPost = false;
        let finalUrl = fetchUrl;
        const c = new AbortController();
        // timer 在 finally 才清除，讓 timeout 涵蓋 HTML body 的完整下載
        const t = setTimeout(() => c.abort(), FETCH_TIMEOUT);
        try {
            // 手動逐跳追蹤 redirect：需登入的貼文最後會被 302 到 ?error=invalid_post，
            // 但 share 短網址中途那一跳是真正的貼文網址（/@user/post/<code>?xmt=…）。
            // redirect:'follow' 只看得到最後一跳，中間的 username / postCode 就拿不到了。
            let resp = null;
            for (let hop = 0; hop < MAX_REDIRECTS; hop++) {
                resp = await fetch(finalUrl, {
                    headers: BROWSER_HEADERS,
                    redirect: 'manual',
                    signal: c.signal,
                });
                if (resp.status < 300 || resp.status >= 400) break;
                const loc = resp.headers.get('location');
                if (resp.body) resp.body.cancel().catch(() => {});
                if (!loc) return null;
                resp = null; // 超過 MAX_REDIRECTS 時視為失敗
                finalUrl = new URL(loc, finalUrl).href;
                const hopM = new URL(finalUrl).pathname.match(THREADS_POST_RE);
                if (hopM) {
                    usernameFromUrl = hopM[1];
                    postCode = hopM[2];
                    if (shareM) resolvedSharePost = true;
                }
            }
            if (!resp) return null;
            // 被重導向到 ?error=invalid_post：需登入或貼文已刪除，離開 try 後再處理
            if (finalUrl.includes('error=invalid_post')) {
                if (resp.body) resp.body.cancel().catch(() => {});
                invalidPost = true;
            } else {
                if (finalUrl.includes('error=') || finalUrl.includes('/login')) return null;
                if (!resp.ok) return null;
                // share 連結沒有導向貼文頁（可能已失效）
                if (!usernameFromUrl || !postCode) return null;
                html = await resp.text();
            }
        } catch (err) {
            console.warn('[threads] fetch 失敗：', err.message);
            return null;
        } finally {
            clearTimeout(t);
        }

        if (invalidPost) {
            // 沒拿到貼文網址（share 短網址直接失效）→ 只能回覆通用訊息
            if (!usernameFromUrl || !postCode) {
                return { type: 'notice', message: '網址錯誤或脆文已刪除' };
            }
            const access = await checkProfileAccess(usernameFromUrl);
            // direct canonical 的公開作者仍視為已刪除；但 share 已成功解出貼文網址時，
            // invalid_post 也可能是單篇限定內容，不能只因個人頁公開就判定已刪除。
            if (access === 'public' && !resolvedSharePost) {
                return { type: 'notice', message: '網址錯誤或脆文已刪除' };
            }
            const noticeRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setStyle(ButtonStyle.Link)
                    .setLabel('開啟原文')
                    .setURL(`https://threads.com/@${usernameFromUrl}/post/${postCode}`)
            );
            const message = access === 'login' || resolvedSharePost
                ? '🔒 此貼文需要登入 Threads 才能檢視（私人帳號或限定內容）'
                : '🔒 無法檢視此貼文：可能需要登入 Threads，或貼文已刪除';
            return { type: 'notice', message, components: [noticeRow.toJSON()] };
        }
        const cleanUrl = `https://www.threads.com/@${usernameFromUrl}/post/${postCode}`;

        const rawOgTitle = pickMeta(html, 'og:title') || '';
        const rawOgDesc  = pickMeta(html, 'og:description') || '';
        const rawOgImage = pickMeta(html, 'og:image') || null;
        const metadataUrls = [pickMeta(html, 'og:url'), pickCanonical(html)].filter(Boolean);

        const chunks = extractSjsChunks(html);
        const found = findPostObject(chunks, postCode, usernameFromUrl);
        const postObjects = (found && found.objects) || [];

        const expectedUsername = usernameFromUrl.toLowerCase();
        const titleAuthor = rawOgTitle.match(/[@＠]([A-Za-z0-9._]+)/);
        const titleAuthorMatches = !titleAuthor || titleAuthor[1].toLowerCase() === expectedUsername;
        const metadataUrlsMatch = metadataUrls.every(value => {
            const identity = threadsPostIdentity(value);
            return identity && identity.code === postCode && identity.username === expectedUsername;
        });
        // OG data is only safe when at least one page-level identity URL binds it to this
        // redirect target. A matching author name alone cannot distinguish two posts by the
        // same account, so metadata without og:url/canonical must fail closed.
        const ogTrusted = !(found && found.ambiguous)
            && titleAuthorMatches
            && metadataUrls.length > 0
            && metadataUrlsMatch;
        const ogTitle = ogTrusted ? rawOgTitle : '';
        const ogDesc  = ogTrusted ? rawOgDesc : '';
        const ogImage = ogTrusted ? rawOgImage : null;

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
        let media = (found && found.media) || [];

        // 引用轉發（quote post）：外層貼文自己的媒體欄位是 null，引用內容掛在
        // share_info.quoted_attachment_post（quoted_post 實測一律是 null，仍留作備援）。
        // 引用的媒體併入媒體清單、文字之後以獨立 field 呈現。
        const quoteCandidates = [];
        for (const obj of postObjects) {
            const info = obj.text_post_app_info && obj.text_post_app_info.share_info;
            if (!info) continue;
            for (const candidate of [info.quoted_attachment_post, info.quoted_post]) {
                if (candidate && typeof candidate === 'object') quoteCandidates.push(candidate);
            }
        }
        let quoted = null;
        if (quoteCandidates.length) {
            const trustedQuoteCandidates = quoteCandidates.filter(candidate => {
                const user = candidate.user || candidate.owner;
                return (candidate.id != null && String(candidate.id))
                    || (candidate.pk != null && String(candidate.pk))
                    || (typeof candidate.code === 'string' && candidate.code)
                    || (user && typeof user.username === 'string' && user.username);
            });
            const quoteIds = new Set();
            const quotePks = new Set();
            const quoteCodes = new Set();
            const quoteUsers = new Set();
            for (const candidate of trustedQuoteCandidates) {
                if (candidate.id != null && String(candidate.id)) quoteIds.add(String(candidate.id));
                if (candidate.pk != null && String(candidate.pk)) quotePks.add(String(candidate.pk));
                if (typeof candidate.code === 'string' && candidate.code) quoteCodes.add(candidate.code);
                const user = candidate.user || candidate.owner;
                if (user && typeof user.username === 'string' && user.username) {
                    quoteUsers.add(user.username.toLowerCase());
                }
            }
            const quoteAmbiguous = quoteIds.size > 1 || quotePks.size > 1
                || quoteCodes.size > 1 || quoteUsers.size > 1;
            const qCaptionSource = trustedQuoteCandidates.find(candidate =>
                candidate.caption && typeof candidate.caption.text === 'string'
            );
            const qUserSource = trustedQuoteCandidates.find(candidate => {
                const user = candidate.user || candidate.owner;
                return user && typeof user.username === 'string' && user.username;
            });
            const qUser = qUserSource && (qUserSource.user || qUserSource.owner);
            const qUsername = qUser ? qUser.username : null;
            const qCodeSource = trustedQuoteCandidates.find(candidate =>
                typeof candidate.code === 'string' && candidate.code
            );
            const qCode = qCodeSource ? qCodeSource.code : null;
            const qMedia = quoteAmbiguous ? [] : selectRichestMedia(trustedQuoteCandidates);
            const qCaption = !quoteAmbiguous && qCaptionSource
                ? qCaptionSource.caption.text : '';
            let qUrl = qUsername && qCode
                ? `https://www.threads.com/@${qUsername}/post/${qCode}` : null;
            if (!qUrl && !quoteAmbiguous) {
                const permalinkSource = trustedQuoteCandidates.find(candidate => {
                    if (typeof candidate.permalink !== 'string') return false;
                    const identity = threadsPostIdentity(candidate.permalink);
                    return identity
                        && (!qCode || identity.code === qCode)
                        && (!qUsername || identity.username === qUsername.toLowerCase());
                });
                if (permalinkSource) qUrl = permalinkSource.permalink;
            }
            if (qMedia.length || qCaption) {
                quoted = { username: qUsername, media: qMedia, caption: qCaption, url: qUrl };
                media = media.concat(qMedia);
            }
        }

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
        const captionSource = postObjects.find(obj =>
            obj.caption && typeof obj.caption.text === 'string'
        );
        if (captionSource) {
            caption = captionSource.caption.text;
        } else {
            caption = ogDesc;
        }
        if (caption.length > 1900) caption = caption.slice(0, 1900) + '…';

        const poll = postObjects.map(extractPoll).find(Boolean) || null;
        const pollField = formatPollField(poll);

        // embed
        // 貼文類型 → 對應顏色（影片項目會同時帶封面圖，判斷以 video 優先）
        const hasVid = media.some(it => it.video);
        const hasImg = media.some(it => it.image && !it.video);
        const postType = poll ? 'poll' : (media.length === 0 ? 'text' : (hasVid && hasImg ? 'mixed' : hasVid ? 'video' : 'image'));

        // 作者頭像；無媒體貼文（純文字 / 投票）的 og:image 通常就是作者頭像，可作為備援。
        // 放在右上角 thumbnail，比 author icon 稍大且不會佔用大圖區。
        const profilePic = postObjects.map(findProfilePic).find(Boolean)
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
        if (quoted) {
            // Discord field value 上限 1024
            let qv = quoted.caption.trim();
            if (qv.length > 1000) qv = qv.slice(0, 1000) + '…';
            if (!qv) qv = quoted.media.some(it => it.video) ? '（影片貼文）' : '（圖片貼文）';
            embed.addFields({
                name: quoted.username ? `↪️ 引用 @${quoted.username} 的貼文` : '↪️ 引用貼文',
                value: qv,
            });
        }
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

        // 開啟原文的連結按鈕（cleanUrl 已去除 ?xmt=… 等追蹤參數）
        const linkRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setStyle(ButtonStyle.Link)
                .setLabel('開啟原文')
                .setURL(cleanUrl)
        );
        if (quoted && quoted.url) {
            linkRow.addComponents(
                new ButtonBuilder()
                    .setStyle(ButtonStyle.Link)
                    .setLabel('開啟引用原文')
                    .setURL(quoted.url)
            );
        }

        return {
            type: 'embed',
            embed: embed.toJSON(),
            embeds: embeds.map(e => e.toJSON()),
            files: mainFiles,
            additionalMessages,
            components: [linkRow.toJSON()],
            originalUrl: cleanUrl,
        };
    },
};
