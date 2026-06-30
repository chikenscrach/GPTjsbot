// handlers/facebook.js
// 基於 fb.py 的完整邏輯，解析 Facebook 短網址為真實主文網址，並替換為 facebed.com 供 Discord 預覽

module.exports = {
	name: 'facebook',

	match(hostname) {
		return ['facebook.com', 'fb.com', 'fb.watch', 'www.facebook.com'].includes(hostname);
	},

	async resolve(url) {
		try {
			const headers = {
				'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
			};

			// 跟隨重導向
			const redirectResp = await fetch(url, { headers, redirect: 'follow' });
			let targetUrl = redirectResp.url;
			let urlObj = new URL(targetUrl);

			// 檢查登入攔截
			if (urlObj.pathname.includes('/login')) {
				const nextParam = urlObj.searchParams.get('next');
				if (nextParam) {
					targetUrl = nextParam;
					urlObj = new URL(targetUrl);
				}
			}

			// 清除追蹤碼，但保留 set 等結構參數
			const paramsToRemove = ['rdid', 'share_url', 'fbclid', 'mibextid'];
			for (const param of paramsToRemove) {
				urlObj.searchParams.delete(param);
			}

			const setParam = urlObj.searchParams.get('set');
			const pathname = urlObj.pathname;
			let finalFbUrl = null;

			// 【Phase 2】檢查是否為多圖貼文 (pcb.XXXX)
			if (setParam && setParam.startsWith('pcb.')) {
				const parentPostId = setParam.replace('pcb.', '');
				const parts = pathname.split('/').filter(Boolean);
				finalFbUrl = `https://www.facebook.com/${parts[0]}/posts/${parentPostId}`;
			} else {
				// 【Phase 3】透過 post.php 解密 pfbid 或將單圖解析為真實數字 ID 主文
				const cleanUrl = urlObj.toString();
				const postPhpUrl = `https://www.facebook.com/plugins/post.php?href=${encodeURIComponent(cleanUrl)}&show_text=true&width=500`;
				
				const embedResp = await fetch(postPhpUrl, { headers });
				const html = await embedResp.text();

				// 尋找 查看更多 (see_more_link) 或 發文時間戳 (_2q21)
				// 使用 Regex 匹配 <a class="... see_more_link ..." href="...">
				const regex = /<a[^>]+class="[^"]*(?:see_more_link|_2q21)[^"]*"[^>]+href="([^"]+)"/;
				const match = html.match(regex);

				if (match && match[1]) {
					// 處理 HTML entities
					let extractedPath = match[1].replace(/&amp;/g, '&');
					if (extractedPath.startsWith('/')) {
						finalFbUrl = `https://www.facebook.com${extractedPath}`;
					} else {
						finalFbUrl = extractedPath;
					}
				} else {
					// 【Fallback 機制】若解算失敗，直接使用 Phase 1 的乾淨網址
					finalFbUrl = cleanUrl;
				}
			}

			if (finalFbUrl) {
				const finalObj = new URL(finalFbUrl);
				// 轉換為 facebed.com 讓 Discord 可以產生預覽
				finalObj.hostname = 'facebed.com';
				// 移除 ref=embed_post 等不需要的追蹤參數
				finalObj.searchParams.delete('ref');
				
				return finalObj.toString() !== url ? finalObj.toString() : null;
			}

			return null;
		} catch (err) {
			console.warn('[Facebook handler] 解析失敗：', err.message);
			return null;
		}
	},
};
