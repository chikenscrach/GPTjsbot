// handlers/threads.js
// 直接在 bot 裡抓 Threads 貼文（支援純文字/單圖/單影片/多圖/多影片/圖文影片混合）。
//
// 做法：
//   1. 用「完整瀏覽器 headers」打 threads.com SSR，拿到含有 data-sjs 完整 JSON 區塊的 HTML。
//      （精簡 headers 只會回 ~260KB 的頁面，缺少 video_versions / image_versions2 / carousel_media）。
//   2. 從 <script type="application/json" data-sjs> 裡定位貼文主物件，抽出媒體清單：
//      - carousel_media 陣列存在 → 逐項抽 image 或 video
//      - 否則 → 頂層 image_versions2 / video_versions 視為單一媒體
//   3. 回傳 1 個主 embed（作者 + 內文 + 第一張圖/封面） + 把其餘圖/所有影片當附件上傳。
//      Discord 會把圖片附件排網格、影片附件顯示原生播放器。
//   4. 超過 10 個附件時分批經由 additionalMessages 回傳，由 messageCreate 逐條送出。
//
// 回傳格式：
//   { type:'embed', embed, files, originalUrl, additionalMessages? }

const { AttachmentBuilder, EmbedBuilder } = require('discord.js');

const FETCH_TIMEOUT = 20000;
const FETCH_MEDIA_TIMEOUT = 25000;
const THREADS_POST_RE = /^\/@([A-Za-z0-9._]+)\/post\/([A-Za-z0-9_-]+)\/?(?:\?.*)?$/;

const THREADS_COLOR = 0x1A1A1A;
const MAX_ATTACH_PER_MSG = 10;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // Discord 未加成伺服器的上限 10MB，超過立即中斷下載
const MAX_PARALLEL_MEDIA = 6;

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
    const top = extractMediaFromObj(obj);
    if (top) items.push(top);
    if (Array.isArray(obj.carousel_media)) {
        for (const c of obj.carousel_media) {
            const e = extractMediaFromObj(c);
            if (e) items.push(e);
        }
    }
    return items;
}

function findPostObject(chunks, shortcode) {
    // 1) 鎖定 target chunk
    let target = null;
    for (const ch of chunks) {
        if (ch.includes(`"code":"${shortcode}"`) &&
            (ch.includes('image_versions2') || ch.includes('carousel_media') || ch.includes('video_versions'))) {
            target = ch; break;
        }
    }
    if (!target) {
        target = chunks.reduce((a, b) => {
            const score = c => (c.match(/video_versions/g) || []).length
                           + (c.match(/carousel_media/g) || []).length
                           + (c.match(/image_versions2/g) || []).length;
            return !a || score(b) > score(a) ? b : a;
        }, null);
    }
    if (!target) return null;

    // 2) 在 target 中從每個 "code":"SHORTCODE" 往外用 {} 配對並 JSON.parse
    const pat = new RegExp(`"code":"${shortcode}"`, 'g');
    let m;
    while ((m = pat.exec(target)) !== null) {
        let i = m.index;
        while (i > 0 && target[i] !== '{') i--;
        if (i <= 0) continue;
        const blk = balancedBlock(target, i, '{', '}');
        if (!blk) continue;
        let obj;
        try { obj = JSON.parse(target.slice(blk[0], blk[1])); } catch { continue; }
        const media = extractMedia(obj);
        if (media.length > 0) return { obj, media };
    }

    // 3) fallback: regex 掃
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

    return { obj: null, media };
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

        // 媒體
        const chunks = extractSjsChunks(html);
        const found = findPostObject(chunks, postCode);
        let media = (found && found.media) || [];
        if (media.length === 0 && ogImage) media = [{ image: ogImage }];

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

        // embed
        const first = media[0];
        const rest  = media.slice(1);

        const embed = new EmbedBuilder()
            .setColor(THREADS_COLOR)
            .setURL(cleanUrl)
            .setFooter({ text: 'Threads' })
            .setAuthor({ name: `${displayName} (@${username})`, url: cleanUrl });
        if (caption && caption.trim()) embed.setDescription(caption.trim());

        // 安排下載：第一個若為影片 → 下載（當附件）；其餘影片 → 下載；其餘圖片 → 下載
        // （圖片用附件才能排出網格；第一張圖直接用 URL 放 embed.setImage）
        const attachments = [];
        const downloads = [];

        if (first) {
            if (first.video) {
                downloads.push({ kind: 'video', url: first.video, idx: attachments.length });
                attachments.push(null);
            }
        }
        for (const it of rest) {
            if (it.video || it.image) {
                downloads.push({ kind: it.video ? 'video' : 'image', url: it.video || it.image, idx: attachments.length });
                attachments.push(null);
            }
        }

        if (downloads.length) {
            const results = await limitParallel(
                downloads.map(d => async () => ({ ...d, res: await fetchMedia(d.url, d.kind) })),
                MAX_PARALLEL_MEDIA
            );
            for (const r of results) {
                if (!r.res || r.res.tooBig) { attachments[r.idx] = null; continue; }
                const fname = `${postCode}_${r.idx}${extFromUrl(r.url, r.kind)}`;
                attachments[r.idx] = new AttachmentBuilder(r.res.buf, { name: fname });
            }
        }
        const files = attachments.filter(Boolean);

        // 封面
        if (first) {
            if (first.image && !first.video) embed.setImage(first.image);
            else if (first.image) embed.setImage(first.image); // video 文也放封面
            else if (ogImage) embed.setImage(ogImage);
        } else if (ogImage) {
            embed.setImage(ogImage);
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
            files: mainFiles,
            additionalMessages,
            originalUrl: cleanUrl,
        };
    },
};
