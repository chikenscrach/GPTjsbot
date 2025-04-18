const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../core/db');

function parseDuration(input) {
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
		.setDescription('提醒功能')
		.addSubcommand(sub =>
			sub.setName('add')
				.setDescription('新增一個提醒')
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
						.setDescription('要提醒的訊息內容（可選）')))
		.addSubcommand(sub =>
			sub.setName('list')
				.setDescription('列出你設定的提醒'))
		.addSubcommand(sub =>
			sub.setName('delete')
				.setDescription('刪除指定提醒')
				.addIntegerOption(option =>
					option.setName('id')
						.setDescription('要刪除的提醒 ID')
						.setRequired(true))
		),

	async execute(interaction) {
		const subcommand = interaction.options.getSubcommand();

		if (subcommand === 'add') {
			const method = interaction.options.getString('method');
			const timeInput = interaction.options.getString('time');
			const customMessage = interaction.options.getString('message');
			const userId = interaction.user.id;
			const channelId = interaction.channel.id;

			let delay;

			if (/^\d{10}$/.test(timeInput)) {
				delay = parseInt(timeInput) * 1000 - Date.now();
			} else {
				delay = parseDuration(timeInput);
			}

			if (!delay || delay <= 0) {
				return interaction.reply({ content: '提醒時間格式錯誤或已過期，請重新輸入。', ephemeral: true });
			}

			const remindAt = Math.floor(Date.now() + delay);

			db.prepare(`
				INSERT INTO reminders (user_id, remind_at, message, method, channel_id)
				VALUES (?, ?, ?, ?, ?)
			`).run(userId, remindAt, customMessage, method, channelId);

			await interaction.reply({
				content: `⏰ 好的！我會在 <t:${Math.floor(remindAt / 1000)}:R> 提醒你。`,
				ephemeral: true,
			});

		} else if (subcommand === 'list') {
			const userId = interaction.user.id;

			const reminders = db.prepare(`
				SELECT id, remind_at, message, method FROM reminders
				WHERE user_id = ?
				ORDER BY remind_at ASC
			`).all(userId);

			if (reminders.length === 0) {
				return interaction.reply({ content: '你目前沒有任何提醒。', ephemeral: true });
			}

			const embed = new EmbedBuilder()
				.setTitle('🔔 你的提醒列表')
				.setColor(0x00BFFF)
				.setTimestamp();

			for (const r of reminders) {
				const time = `<t:${Math.floor(r.remind_at / 1000)}:R>`;
				embed.addFields({
					name: `#${r.id} (${r.method})`,
					value: `${r.message || '(無內容)'}\n🕒 ${time}`,
				});
			}

			return interaction.reply({ embeds: [embed], ephemeral: true });

		} else if (subcommand === 'delete') {
			const id = interaction.options.getInteger('id');
			const userId = interaction.user.id;

			const reminder = db.prepare('SELECT * FROM reminders WHERE id = ?').get(id);

			if (!reminder) {
				return interaction.reply({ content: '找不到這個提醒。', ephemeral: true });
			}

			if (reminder.user_id !== userId) {
				return interaction.reply({ content: '你無權刪除此提醒。', ephemeral: true });
			}

			db.prepare('DELETE FROM reminders WHERE id = ?').run(id);
			return interaction.reply({ content: `✅ 提醒 #${id} 已刪除。`, ephemeral: true });
		}
	},
};
