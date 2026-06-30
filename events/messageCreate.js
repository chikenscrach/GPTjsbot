const { Events } = require('discord.js');
const handlers = require('../handlers');

module.exports = {
	name: Events.MessageCreate,
	async execute(message) {
		if (message.author.bot) return;

		const urlRegex = /(https?:\/\/[^\s\])>]+)/g;
		const urls = message.content.match(urlRegex);
		if (!urls) return;

		const converted = [];
		let shouldSuppressAndReply = false;

		for (const url of urls) {
			const hostname = (() => {
				try {
					return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
				} catch {
					return '';
				}
			})();

			for (const handler of handlers) {
				if (handler.match(hostname)) {
					const result = await handler.resolve(url);
					if (result && result !== url) {
						converted.push(result);
						shouldSuppressAndReply = true;
					}
					break;
				}
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