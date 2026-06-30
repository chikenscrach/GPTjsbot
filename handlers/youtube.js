// handlers/youtube.js

const { extractYouTubeIdFromUrl } = require('../utils/youtube');

module.exports = {
	name: 'youtube',

	match(hostname) {
		return ['youtube.com', 'youtu.be', 'youtube-nocookie.com', 'm.youtube.com'].includes(hostname);
	},

	async resolve(url) {
		// 如果網址已經是理想的 youtu.be 短網址格式，直接跳過不做任何處理
		if (/^https?:\/\/youtu\.be\/[a-zA-Z0-9_-]{11}$/.test(url.trim())) {
			return null;
		}
		return extractYouTubeIdFromUrl(url);
	},
};
