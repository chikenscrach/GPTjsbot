// handlers/simple.js
// 簡單域名替換的平台（pixiv, tiktok, instagram, bsky, bilibili, b23.tv）

const replacements = {
	'pixiv.net': 'phixiv.net',
	'tiktok.com': 'tnktok.com',
	'instagram.com': 'kkinstagram.com',
	'bsky.app': 'fxbsky.app',
	'bilibili.com': 'vxbilibili.com',
	'b23.tv': 'vxb23.tv',
};

module.exports = {
	name: 'simple',

	match(hostname) {
		return hostname in replacements;
	},

	async resolve(url) {
		try {
			const hostname = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
			const replacement = replacements[hostname];
			if (!replacement) return null;

			const regex = new RegExp(`(https?:\\/\\/)(www\\.)?${hostname.replace(/\./g, '\\.')}`, 'i');
			const newUrl = url.replace(regex, `$1${replacement}`).split('?')[0];
			return newUrl !== url ? newUrl : null;
		} catch {
			return null;
		}
	},
};
