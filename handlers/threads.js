// handlers/threads.js

module.exports = {
	name: 'threads',

	match(hostname) {
		return hostname === 'threads.net' || hostname === 'threads.com';
	},

	async resolve(url) {
		try {
			const parsed = new URL(url);

			// 根據 2026 年最新情況，統一轉為 threads.com
			const newUrl = `https://threads.com${parsed.pathname}`;

			return newUrl !== url ? newUrl : null;
		} catch {
			return null;
		}
	},
};
