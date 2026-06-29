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
			'instagram.com': 'kkinstagram.com',
			'bsky.app': 'fxbsky.app',
			'bilibili.com': 'vxbilibili.com',
			'b23.tv': 'vxb23.tv',
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
				const newUrl = url.replace(/^(https?:\/\/)(www\.)?(x|twitter)\.com/, '$1fixvx.com').split('?')[0];
				if (newUrl !== url) {
					converted.push(newUrl);
					shouldSuppressAndReply = true;
				}
				continue;
			}

			// 處理 YouTube 影片
			// 如果網址已經是理想的 youtu.be 短網址格式，直接跳過不做任何處理
			if (/^https?:\/\/youtu\.be\/[a-zA-Z0-9_-]{11}$/.test(url.trim())) {
				continue;
			}
			const yt = extractYouTubeIdFromUrl(url);
			if (yt) {
				converted.push(yt);
				shouldSuppressAndReply = true;
				continue;
			}

			// 處理 Threads 官方網址（移除 www 及 URL tracker）
			if (parsedDomain === 'threads.com') {
				try {
					const parsed = new URL(url);
			
					const newUrl = `https://threads.com${parsed.pathname}`;
			
					if (newUrl !== url) {
						converted.push(newUrl);
						shouldSuppressAndReply = true;
					}
			
					continue;
				} catch {
					continue;
				}
			}

			// 處理其他平台
			let replaced = null;
			for (const [domain, replacement] of Object.entries(replacements)) {
				if (parsedDomain === domain) {
					const regex = new RegExp(`(https?:\\/\\/)(www\\.)?${domain.replace(/\\./g, '\\\\.')}`, 'i');
					replaced = url.replace(regex, `$1${replacement}`).split('?')[0];
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
