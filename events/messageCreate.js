const { Events } = require('discord.js');
const { extractYouTubeIdFromUrl } = require('../utils/youtube');

module.exports = {
	name: Events.MessageCreate,
	async execute(message) {
		if (message.author.bot) return;

		const urlRegex = /(https?:\/\/[^\s]+)/g;
		const urls = message.content.match(urlRegex);
		if (!urls) return;

		const replacements = {
			'pixiv.net': 'phixiv.net',
			'tiktok.com': 'tnktok.com',
			'instagram.com': 'ddinstagram.com',
			'threads.net': 'fixthreads.net',
			'bsky.app': 'fxbsky.app',
		};

		const converted = [];
		let shouldSuppressAndReply = false;

		for (const url of urls) {
			const parsedDomain = (() => {
				try {
					return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
				} catch {
					return '';
				}
			})();

			// 完全符合 x.com / twitter.com 才處理
			if (parsedDomain === 'x.com' || parsedDomain === 'twitter.com') {
				const newUrl = url.replace(/^(https?:\/\/)(www\.)?(x|twitter)\.com/, '$1girlcockx.com').split('?')[0];
				if (newUrl !== url) {
					converted.push(newUrl);
					shouldSuppressAndReply = true;
				}
				continue;
			}

			// 處理 YouTube 影片
			const yt = extractYouTubeIdFromUrl(url);
			if (yt) {
				if (url.trim() !== yt) {
					converted.push(yt);
					shouldSuppressAndReply = true;
				}
				continue;
			}

			// 處理其他平台
			let replaced = null;
			for (const [domain, replacement] of Object.entries(replacements)) {
				if (parsedDomain === domain) {
					replaced = url.replace(domain, replacement).split('?')[0];
					break;
				}
			}
			if (replaced) {
				converted.push(replaced);
				shouldSuppressAndReply = true;
			}
		}

		if (converted.length === 0) return;

		if (shouldSuppressAndReply) {
			try {
				await message.suppressEmbeds(true);
			} catch (err) {
				console.warn('無法關閉 embed：', err);
			}
		}

		await message.channel.send({
			content: converted.join('\n'),
			reply: shouldSuppressAndReply ? { messageReference: message.id } : undefined,
			allowedMentions: { repliedUser: false }
		});
	}
};
