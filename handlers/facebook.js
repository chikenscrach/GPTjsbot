// handlers/facebook.js
// 基於 fb.js 整合版邏輯，解析 Facebook 短網址為真實主文網址，並替換為 facebed.com 供 Discord 預覽

/**
 * 用 plugins/post.php 外嵌還原「相片所屬的母貼文」
 * 使用爬蟲 UA，抽取 ?ref=embed_post 連結
 */
async function fetchEmbed(href, headers) {
	const url = `https://www.facebook.com/plugins/post.php?href=${encodeURIComponent(href)}&show_text=true&width=500`;
	const r = await fetch(url, { headers });
	const html = await r.text();
	if (r.status !== 200 || html.length < 3000) return null;

	// 母貼文標準連結：<a href="/{owner}/posts/{id}?ref=embed_post">
	const m = html.match(/href="\/([^"?]+\/posts\/\d+)\?ref=embed_post"/i)
		|| html.match(/facebook\.com\/([^"'\\?]+\/posts\/\d+)\?ref=embed_post/i);

	if (m) {
		return `https://www.facebook.com/${m[1]}`;
	}
	return null;
}

const decodeEntities = (s) => s == null ? s : s
	.replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
	.replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
	.replace(/&amp;/g, '&').replace(/&quot;/g, '"')
	.replace(/&#039;|&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

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
			const resp = await fetch(url, { headers, redirect: 'follow' });
			const html = await resp.text();
			let finalUrl = resp.url;
			let urlObj = new URL(finalUrl);

			// 破解 login 攔截，取 next 參數裡真正的跳轉網址
			let loginWalled = false;
			if (urlObj.pathname.includes('/login')) {
				loginWalled = true;
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
			// 若 canonicalUrl 是單張相片，清空它以強制走 fallback 取母貼文 (post)
			if (canonicalUrl && canonicalUrl.includes('/photos/')) canonicalUrl = null;

			let resultUrl = null;

			if (canonicalUrl) {
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
			} else {
				// ---- Fallback：被 login 擋住（多半是「相片」連結）----
				const fbid = urlObj.searchParams.get('fbid');
				const setParam = urlObj.searchParams.get('set');

				if (fbid || urlObj.pathname.includes('/photo')) {
					// 若 set=pcb.<母貼文id>，直接由 set 還原母貼文
					if (setParam && setParam.startsWith('pcb.')) {
						const parentId = setParam.replace('pcb.', '');
						const parts = urlObj.pathname.split('/').filter(Boolean);
						const owner = parts[0] && parts[0] !== 'photo.php' ? parts[0] : null;
						if (owner) {
							resultUrl = `https://www.facebook.com/${owner}/posts/${parentId}`;
						}
					}

					// 嘗試用 post.php 外嵌取得母貼文
					if (!resultUrl) {
						try {
							const embedResult = await fetchEmbed(cleanUrl, headers);
							if (embedResult) {
								resultUrl = embedResult;
							}
						} catch {}
					}

					// 最終備援：返回相片頁乾淨網址
					if (!resultUrl) {
						resultUrl = `https://www.facebook.com/photo.php?fbid=${fbid}${setParam ? '&set=' + setParam : ''}&type=3`;
					}
				} else {
					// 最後備援：story_fbid / 路徑末段
					resultUrl = cleanUrl;
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
