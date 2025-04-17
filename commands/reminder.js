const { SlashCommandBuilder, ChannelType } = require('discord.js');

function parseDuration(input) {
	// 支援格式：XdXhXm
	const regex = /(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?/;
	const matches = input.match(regex);
	if (!matches) return null;

	const days = parseInt(matches[1]) || 0;
	const hours = parseInt(matches[2]) || 0;
	const minutes = parseInt(matches[3]) || 0;

	return ((days * 24 + hours) * 60 + minutes) * 60 * 1000;
}

module.exports = {
	data: new SlashCommandBuilder()
		.setName('reminder')
		.setDescription('設定一個提醒')
		.addStringOption(option =>
			option.setName('method')
				.setDescription('提醒方式：channel 或 dm')
				.setRequired(true)
				.addChoices(
					{ name: '頻道', value: 'channel' },
					{ name: '私訊', value: 'dm' }
				))
		.addStringOption(option =>
			option.setName('time')
				.setDescription('提醒時間，可為 XdXhXm 或 Unix 時間戳')
				.setRequired(true))
		.addStringOption(option =>
			option.setName('message')
				.setDescription('要提醒的訊息內容（可選）')),

	async execute(interaction) {
		const method = interaction.options.getString('method');
		const timeInput = interaction.options.getString('time');
		const customMessage = interaction.options.getString('message');
		const userMention = `<@${interaction.user.id}>`;

		let delay;

		if (/^\d{10}$/.test(timeInput)) {
			// Unix timestamp
			const targetTime = parseInt(timeInput) * 1000;
			delay = targetTime - Date.now();
		} else {
			// XdXhXm
			delay = parseDuration(timeInput);
		}

		if (!delay || delay <= 0) {
			return interaction.reply({ content: '提醒時間格式錯誤或已過期，請重新輸入。', ephemeral: true });
		}
		
		const unixTime = Math.floor(Date.now() + delay) / 1000;
		await interaction.reply({
			content: `⏰ 好的！我會在 <t:${Math.floor(unixTime)}:R> 提醒你。`,
			ephemeral: true,
		});

		setTimeout(async () => {
			const message = customMessage || userMention;

			if (method === 'dm') {
				try {
					await interaction.user.send(`⏰ 提醒：${message}`);
				} catch (err) {
					console.error('無法發送 DM：', err);
				}
			} else {
				await interaction.channel.send(`⏰ 提醒：${message}`);
			}
		}, delay);
	},
};
