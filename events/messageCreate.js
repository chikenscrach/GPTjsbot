const { Events, EmbedBuilder } = require('discord.js');
const handlers = require('../handlers');

// Discord 單一訊息的附件上限
const MAX_ATTACH_PER_MSG = 10;

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
		if (!result) return null;
		// 與原網址相同時視為無轉換，避免回覆重複的連結
		if (typeof result === 'string') return result !== url ? { type: 'url', value: result } : null;
		if (result && result.type === 'embed' && result.embed) return result;
		// handler 回報的提示文字（例如貼文已刪除）
		if (result && result.type === 'notice' && result.message) return result;
		if (typeof result === 'object' && result.url) return { type: 'url', value: result.url };
		return null;
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

		const uniqueUrls = [...new Set(urls)];
		const results = await Promise.all(uniqueUrls.map(convertUrl));
		const items = results.filter(Boolean);
		if (items.length === 0) return;

		const convertedUrls = items.filter(i => i.type === 'url').map(i => i.value);
		const embedItems  = items.filter(i => i.type === 'embed' && i.embed);
		const noticeTexts = items.filter(i => i.type === 'notice').map(i => i.message);

		// 準備主訊息
		const mainEmbeds = embedItems
			.map(i => new EmbedBuilder(i.embed))
			.slice(0, 10);
		// 多則貼文的附件合併後可能超過單一訊息上限，超出的部分分批到後續訊息
		const allFiles = embedItems
			.flatMap(i => Array.isArray(i.files) ? i.files : []);
		const mainFiles = allFiles.slice(0, MAX_ATTACH_PER_MSG);
		const overflowFiles = allFiles.slice(MAX_ATTACH_PER_MSG);

		// notice 只是提示訊息，不算實際轉換，不需要關閉原訊息的 embed
		const hasPayload =
			mainEmbeds.length > 0 ||
			mainFiles.length > 0 ||
			convertedUrls.length > 0;

		if (hasPayload) {
			try { await message.suppressEmbeds(true); }
			catch (err) { console.warn('無法關閉 embed：', err.message); }
		}

		const payload = {
			reply: { messageReference: message.id },
			allowedMentions: { repliedUser: false },
		};
		if (mainEmbeds.length) payload.embeds = mainEmbeds;
		if (mainFiles.length)  payload.files  = mainFiles;
		const contentParts = [...convertedUrls, ...noticeTexts];
		if (contentParts.length) payload.content = contentParts.join('\n');

		if (payload.content || (payload.embeds && payload.embeds.length) || (payload.files && payload.files.length)) {
			try {
				await message.channel.send(payload);
			} catch (err) {
				console.warn('無法送出轉換後的訊息：', err);
				// 附件上傳失敗（如超過伺服器檔案大小上限）時，退回純 embed / 連結再試一次
				if (payload.files) {
					delete payload.files;
					if (payload.content || payload.embeds) {
						try {
							await message.channel.send(payload);
						} catch (err2) {
							console.warn('退回無附件訊息仍失敗：', err2);
						}
					}
				}
			}
		}

		// 額外訊息：先送主訊息放不下的附件批次，再送 handler 自帶的批次
		const extra = [];
		for (let i = 0; i < overflowFiles.length; i += MAX_ATTACH_PER_MSG) {
			extra.push({ files: overflowFiles.slice(i, i + MAX_ATTACH_PER_MSG) });
		}
		for (const item of embedItems) {
			if (Array.isArray(item.additionalMessages)) extra.push(...item.additionalMessages);
		}
		for (const msg of extra) {
			try {
				await message.channel.send({
					content: msg.content,
					files:   msg.files,
					embeds:  msg.embeds ? msg.embeds.map(e => new EmbedBuilder(e)) : undefined,
					allowedMentions: { repliedUser: false },
				});
			} catch (err) {
				console.warn('無法送出額外媒體訊息：', err);
			}
		}
	},
};
