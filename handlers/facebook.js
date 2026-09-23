// handlers/facebook.js
// 基於 fb.js 整合版邏輯，解析 Facebook 短網址為真實主文網址，並替換為 facebed.com 供 Discord 預覽

// 單次請求的逾時上限，避免 Facebook 回應緩慢時無限懸掛
const FETCH_TIMEOUT_MS = 8000;

/**
 * 用 plugins/post.php 外嵌還原「相片所屬的母貼文」
 * 使用爬蟲 UA，抽取 ref=embed_post 連結；群組相片可能只提供 set=gm.<母貼文id>。
 */
async function fetchEmbed(href, headers) {
	const url = `https://www.facebook.com/plugins/post.php?href=${encodeURIComponent(href)}&show_text=true&width=500`;
	const r = await fetch(url, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
	const html = await r.text();
	if (r.status !== 200) return null;

	const links = [...html.matchAll(/<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1/gi)]
		.map(match => parseFacebookUrl(match[2]))
		.filter(link => link && link.searchParams.get('ref') === 'embed_post');
	for (const link of links) {
		if (/^\/(?:[^/]+\/posts|groups\/[^/]+\/(?:posts|permalink))\/\d+\/?$/.test(link.pathname)) {
			return `https://www.facebook.com${link.pathname.replace(/\/$/, '')}`;
		}
	}

	// 只採用同一張相片的群組母文 ID，避免從推薦或其他相片誤抓貼文。
	const photoId = photoIdFromUrl(href);
	if (photoId) {
		const parentIds = new Set();
		for (const link of links) {
			if (photoIdFromUrl(link.href) !== photoId) continue;
			const parentId = link.searchParams.get('set')?.match(/^gm\.(\d+)$/)?.[1];
			if (parentId) parentIds.add(parentId);
		}
		if (parentIds.size === 1) return fetchGroupPost([...parentIds][0], headers);
	}
	return null;
}

const decodeEntities = (s) => s == null ? s : s
	.replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
	.replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
	.replace(/&amp;/g, '&').replace(/&quot;/g, '"')
	.replace(/&#039;|&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

const isPhotoUrl = (value) => {
	try {
		const pathname = new URL(value, 'https://www.facebook.com').pathname;
		return /\/(?:photo(?:\.php)?|photos)(?:\/|$)/i.test(pathname);
	} catch {
		return false;
	}
};

function parseFacebookUrl(value) {
	if (!value) return null;
	try {
		const parsed = new URL(decodeEntities(value), 'https://www.facebook.com');
		return /^https?:$/.test(parsed.protocol) && /(^|\.)(?:facebook|fb)\.com$/i.test(parsed.hostname)
			&& !parsed.username && !parsed.password ? parsed : null;
	} catch {
		return null;
	}
}

function photoIdFromUrl(value) {
	const parsed = parseFacebookUrl(value);
	if (!parsed || !isPhotoUrl(parsed.href)) return null;
	const id = parsed.searchParams.get('fbid')
		|| parsed.pathname.match(/\/photos\/(?:[^/]+\/)*(\d+)\/?$/i)?.[1];
	return id && /^\d+$/.test(id) ? id : null;
}

async function fetchGroupPost(postId, headers) {
	// Facebook 可由全域貼文 ID 導向所屬群組，無須把相片作者誤當成群組。
	const r = await fetch(`https://www.facebook.com/${postId}`, {
		headers, redirect: 'follow', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
	});
	if (r.status !== 200) {
		await r.body?.cancel();
		return null;
	}
	const html = await r.text();
	const redirected = parseFacebookUrl(r.url);
	const candidates = [r.url];
	if (redirected?.pathname.startsWith('/login')) candidates.push(redirected.searchParams.get('next'));
	for (const tag of html.match(/<(?:link|meta)\b[^>]*>/gi) || []) {
		const attrs = {};
		for (const match of tag.matchAll(/\b([\w:-]+)\s*=\s*(["'])(.*?)\2/g)) {
			attrs[match[1].toLowerCase()] = match[3];
		}
		if (attrs.rel?.toLowerCase() === 'canonical') candidates.push(attrs.href);
		if (attrs.property?.toLowerCase() === 'og:url') candidates.push(attrs.content);
	}
	for (const candidate of candidates) {
		const parsed = parseFacebookUrl(candidate);
		const match = parsed?.pathname.match(/^\/groups\/([^/]+)\/(?:posts|permalink)\/(\d+)\/?$/);
		if (match && match[2] === postId) {
			return `https://www.facebook.com/groups/${match[1]}/posts/${postId}`;
		}
	}
	return null;
}

// 影片 ID 已足夠定位影片；移除標題、發布者路徑與追蹤參數。
const normalizeVideoUrl = (value) => {
	if (!value) return null;
	try {
		const parsed = new URL(value, 'https://www.facebook.com');
		if (!/^https?:$/.test(parsed.protocol) || !/(^|\.)(?:facebook|fb)\.com$/i.test(parsed.hostname)) return null;

		const pathId = parsed.pathname.match(/^\/[^/]+\/videos\/(?:[^/]+\/)?(\d+)\/?$/i)?.[1];
		const watchId = /^\/watch\/?$/i.test(parsed.pathname) ? parsed.searchParams.get('v') : null;
		const videoId = pathId || watchId;
		return videoId && /^\d+$/.test(videoId)
			? `https://www.facebook.com/watch/?v=${videoId}`
			: null;
	} catch {
		return null;
	}
};

module.exports = {
	name: 'facebook',

	match(hostname) {
		return ['facebook.com', 'fb.com', 'fb.watch'].includes(hostname);
	},

	async resolve(url) {
		try {
			const headers = {
				'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
				'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
			};

			// ---- Phase 1：追蹤重導向 ----
			const resp = await fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
			const html = await resp.text();
			let finalUrl = resp.url;
			let urlObj = new URL(finalUrl);

			// 破解 login 攔截，取 next 參數裡真正的跳轉網址
			if (urlObj.pathname.includes('/login')) {
				const nextParam = urlObj.searchParams.get('next');
				if (nextParam) {
					finalUrl = nextParam;
					urlObj = new URL(finalUrl);
				}
			}

			// 清洗追蹤參數
			['rdid', 'share_url', 'fbclid', 'mibextid'].forEach(p => urlObj.searchParams.delete(p));
			const cleanUrl = urlObj.href;

			// ---- Phase 2：從 meta 標籤解析（未被擋登入時最完整）----
			const pick = (re) => { const m = html.match(re); return m ? decodeEntities(m[1]) : null; };
			let canonicalUrl =
				pick(/<link[^>]+rel="canonical"[^>]+href="([^"]+)"/i) ||
				pick(/<meta[^>]+property="og:url"[^>]+content="([^"]+)"/i);
			// login 頁的 canonical 會是 .../login，視為無效
			if (canonicalUrl && /\/login\/?$/.test(canonicalUrl)) canonicalUrl = null;
			// 相片 canonical 可能是 /photo/、/photo.php 或 /{owner}/photos/...；
			// 清空它以強制走 fallback，從外嵌頁取得真正的母貼文。
			if (canonicalUrl && isPhotoUrl(canonicalUrl)) canonicalUrl = null;

			// 優先使用影片 metadata，再檢查重新導向（含 login next）及原始網址。
			let resultUrl = normalizeVideoUrl(canonicalUrl)
				|| normalizeVideoUrl(cleanUrl)
				|| normalizeVideoUrl(url);

			if (!resultUrl && canonicalUrl) {
				// ---- 有 canonical：一般貼文（粉專 / 群組）----
				const idMatch = canonicalUrl.match(/\/(?:posts|permalink|videos)\/(?:[^/]*\/)?(\d{6,})\/?$/)
					|| canonicalUrl.match(/\/(?:posts|permalink|videos)\/(\d{6,})/);
				const postId = idMatch && idMatch[1];

				// 群組貼文格式轉換：/groups/{id}/posts/{id} → /groups/{id}/permalink/{id}
				const g = canonicalUrl.match(/\/groups\/(\d+)\/posts\/(\d+)/);
				if (g) {
					resultUrl = `https://www.facebook.com/groups/${g[1]}/permalink/${g[2]}`;
				} else {
					const page = canonicalUrl.match(/facebook\.com\/([^/]+)\/posts\//);
					if (page && postId) {
						resultUrl = `https://www.facebook.com/${page[1]}/posts/${postId}`;
					} else {
						resultUrl = canonicalUrl;
					}
				}
			} else if (!resultUrl) {
				// ---- Fallback：無 canonical（被 login 擋住，如 photo、story.php、pfbid 等）----
				const fbid = urlObj.searchParams.get('fbid');
				const setParam = urlObj.searchParams.get('set');

				// 若 set=pcb.<母貼文id>，直接由 set 還原母貼文
				const parentId = setParam?.match(/^pcb\.(\d+)$/)?.[1];
				if (parentId) {
					const parts = urlObj.pathname.split('/').filter(Boolean);
					const owner = parts[1] === 'photos' && parts[0] !== 'groups' ? parts[0] : null;
					if (owner) {
						resultUrl = `https://www.facebook.com/${owner}/posts/${parentId}`;
					}
				}

				// 嘗試用 post.php 外嵌解析取得母貼文（可破解 photo.php, story.php, pfbid 等）
				if (!resultUrl) {
					try {
						const embedResult = await fetchEmbed(cleanUrl, headers);
						if (embedResult) {
							resultUrl = embedResult;
						}
					} catch {}
				}

				// 最終備援：有 fbid 時回相片頁乾淨網址，否則回 cleanUrl
				if (!resultUrl) {
					if (fbid) {
						resultUrl = `https://www.facebook.com/photo.php?fbid=${fbid}${setParam ? '&set=' + setParam : ''}&type=3`;
					} else {
						resultUrl = cleanUrl;
					}
				}
			}

			if (resultUrl) {
				const resultObj = new URL(resultUrl);
				// 轉換為 facebed.com 讓 Discord 可以產生預覽
				resultObj.hostname = 'facebed.com';
				// 移除不需要的追蹤參數
				resultObj.searchParams.delete('ref');

				return resultObj.toString() !== url ? resultObj.toString() : null;
			}

			return null;
		} catch (err) {
			console.warn('[Facebook handler] 解析失敗：', err.message);
			return null;
		}
	},
};
