const { Events } = require('discord.js');
const handlers = require('../handlers');

async function convertUrl(url) {
	let hostname;
	try {
		hostname = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
	} catch {
		return null;
	}

	const handler = handlers.find(h => h.match(hostname));
	if (!handler) return null;

	try {
		const result = await handler.resolve(url);
		return result && result !== url ? result : null;
	} catch (err) {
		console.warn(`[${handler.name} handler] 解析失敗：`, err);
		return null;
	}
}

module.exports = {
	name: Events.MessageCreate,
	async execute(message) {
		if (message.author.bot) return;

		const urlRegex = /(https?:\/\/[^\s\])>]+)/g;
		const urls = message.content.match(urlRegex);
		if (!urls) return;

		// 去除重複網址後平行解析，避免逐一等待造成延遲
		const uniqueUrls = [...new Set(urls)];
		const results = await Promise.all(uniqueUrls.map(convertUrl));
		const converted = results.filter(Boolean);

		if (converted.length === 0) return;

		try {
			await message.suppressEmbeds(true);
		} catch (err) {
			console.warn('無法關閉 embed：', err);
		}

		try {
			await message.channel.send({
				content: converted.join('\n'),
				reply: { messageReference: message.id },
				allowedMentions: { repliedUser: false }
			});
		} catch (err) {
			console.warn('無法發送轉換後的網址：', err);
		}
	}
};
