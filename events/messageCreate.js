const { Events, EmbedBuilder } = require('discord.js');
const handlers = require('../handlers');
const { recordConvertedMessage } = require('../core/converted-messages');
const { normalizeHostname } = require('../core/url-config');
const urlSettings = require('../core/url-settings');

// Discord 單一訊息的附件上限
const MAX_ATTACH_PER_MSG = 10;

async function convertUrl(url, guildId) {
	let hostname;
	try {
		hostname = normalizeHostname(new URL(url).hostname);
	} catch {
		return null;
	}

	const handler = handlers.find(h => h.match(hostname));
	if (!handler) return null;
	const target = handler.name === 'simple' ? handler.getRule(hostname).id : handler.name;
	// 在解析或下載媒體之前檢查；專用處理器停用後不會落入簡單轉換。
	if (!urlSettings.getTarget(guildId, target).enabled) return { type: 'disabled' };

	try {
		const result = await handler.resolve(url);
		if (!result) return null;
		// 與原網址相同時視為無轉換，避免回覆重複的連結
		if (typeof result === 'string') return result !== url ? { type: 'url', value: result } : null;
		if (result && result.type === 'embed' && (result.embed || Array.isArray(result.embeds))) return { ...result };
		// handler 回報的提示文字（例如貼文已刪除）
		if (result && result.type === 'notice' && result.message) return { ...result };
		if (typeof result === 'object' && result.url) return { type: 'url', value: result.url };
		return null;
	} catch (err) {
		console.warn(`[${handler.name} handler] 解析失敗：`, err);
		return null;
	}
}

async function sendConvertedMessage(source, payload) {
	const sent = await source.channel.send(payload);
	try {
		recordConvertedMessage(sent, source);
	} catch (err) {
		// 發送已成功，不能因記錄失敗再走附件 fallback，否則會重複發送。
		console.error('無法保存網址轉換訊息發送者：', err);
	}
	return sent;
}

module.exports = {
	name: Events.MessageCreate,
	async execute(message) {
		if (message.author.bot) return;
		if (!urlSettings.getMaster(message.guildId).enabled) return;

		const urlRegex = /(https?:\/\/[^\s\])>]+)/g;
		const urls = message.content.match(urlRegex);
		if (!urls) return;

		const uniqueUrls = [...new Set(urls)];
		const results = await Promise.all(uniqueUrls.map(url => convertUrl(url, message.guildId)));
		const hasDisabledUrl = results.some(item => item?.type === 'disabled');
		const items = results.filter(item => item && item.type !== 'disabled');
		if (items.length === 0) return;

		const convertedUrls = items.filter(i => i.type === 'url').map(i => i.value);
		const embedItems  = items.filter(i => i.type === 'embed' && (i.embed || Array.isArray(i.embeds)));
		const noticeItems = items.filter(i => i.type === 'notice');
		const noticeTexts = noticeItems.map(i => i.message);
		// 準備主訊息
		const mainEmbeds = embedItems
			.flatMap(i => Array.isArray(i.embeds) ? i.embeds : (i.embed ? [i.embed] : []))
			.map(e => new EmbedBuilder(e))
			.slice(0, 10);
		// 多則貼文的附件合併後可能超過單一訊息上限，超出的部分分批到後續訊息
		const allFiles = embedItems.flatMap(item =>
			(Array.isArray(item.files) ? item.files : []));
		const mainFiles = allFiles.slice(0, MAX_ATTACH_PER_MSG);
		const overflowFiles = allFiles.slice(MAX_ATTACH_PER_MSG);
		// handler 附帶的按鈕列（如 Threads 的「開啟原文」，notice 提示也可能附帶）；
		// Discord 單一訊息最多 5 列
		const mainComponents = [...embedItems, ...noticeItems]
			.flatMap(i => Array.isArray(i.components) ? i.components : [])
			.slice(0, 5);

		// notice 只是提示訊息，不算實際轉換，不需要關閉原訊息的 embed
		const hasPayload =
			mainEmbeds.length > 0 ||
			mainFiles.length > 0 ||
			convertedUrls.length > 0;

		// Discord 只能隱藏整則訊息的預覽，混合停用平台時保留原預覽。
		if (hasPayload && !hasDisabledUrl) {
			try { await message.suppressEmbeds(true); }
			catch (err) { console.warn('無法關閉 embed：', err.message); }
		}

		const payload = {
			reply: { messageReference: message.id },
			allowedMentions: { repliedUser: false },
		};
		if (mainEmbeds.length) payload.embeds = mainEmbeds;
		if (mainFiles.length)  payload.files  = mainFiles;
		if (mainComponents.length) payload.components = mainComponents;
		const contentParts = [...convertedUrls, ...noticeTexts];
		if (contentParts.length) payload.content = contentParts.join('\n');

		if (payload.content || (payload.embeds && payload.embeds.length) || (payload.files && payload.files.length)) {
			try {
				await sendConvertedMessage(message, payload);
			} catch (err) {
				console.warn('無法送出轉換後的訊息：', err);
				// 附件上傳失敗（如超過伺服器檔案大小上限）時，退回純 embed / 連結再試一次
				if (payload.files) {
					delete payload.files;
					if (payload.content || payload.embeds) {
						try {
							await sendConvertedMessage(message, payload);
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
			const batch = overflowFiles.slice(i, i + MAX_ATTACH_PER_MSG);
			extra.push({
				content: i === 0 ? '📎 其他媒體：' : undefined,
				files: batch,
			});
		}
		for (const item of embedItems) {
			if (Array.isArray(item.additionalMessages)) {
				extra.push(...item.additionalMessages);
			}
		}
		for (const msg of extra) {
			try {
				// 額外訊息可能是一般附件批次，也可能是 Components V2；只轉送
				// handler 支援的欄位，讓 handler 決定每種訊息的合法組合。
				const extraPayload = {
					allowedMentions: { repliedUser: false },
				};
				if (msg.content !== undefined) extraPayload.content = msg.content;
				if (msg.files !== undefined) extraPayload.files = msg.files;
				if (msg.embeds) {
					extraPayload.embeds = msg.embeds.map(e => new EmbedBuilder(e));
				}
				if (msg.flags !== undefined) extraPayload.flags = msg.flags;
				if (msg.components) extraPayload.components = msg.components;
				await sendConvertedMessage(message, extraPayload);
			} catch (err) {
				console.warn('無法送出額外媒體訊息：', err);
			}
		}
	},
};
