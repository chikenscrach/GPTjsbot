const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const db = require('../core/db');

// SQL 語句只需準備一次，重複使用以省去每次執行時的解析成本
const insertReminder = db.prepare(`
	INSERT INTO reminders (user_id, remind_at, message, method, channel_id)
	VALUES (?, ?, ?, ?, ?)
`);
const listReminders = db.prepare(`
	SELECT id, remind_at, message, method FROM reminders
	WHERE user_id = ?
	ORDER BY remind_at ASC
`);
const deleteReminder = db.prepare('DELETE FROM reminders WHERE id = ? AND user_id = ?');

// Discord embed 最多允許 25 個欄位
const MAX_EMBED_FIELDS = 25;

function parseDuration(input) {
	const regex = /^(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?$/;
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
			const channelId = interaction.channelId;

			let delay;

			if (/^\d{10}$/.test(timeInput)) {
				delay = parseInt(timeInput) * 1000 - Date.now();
			} else {
				delay = parseDuration(timeInput);
			}

			if (!delay || delay <= 0) {
				return interaction.reply({ content: '提醒時間格式錯誤或已過期，請重新輸入。', flags: MessageFlags.Ephemeral });
			}

			const remindAt = Math.floor(Date.now() + delay);

			insertReminder.run(userId, remindAt, customMessage, method, channelId);

			await interaction.reply({
				content: `⏰ 好的！我會在 <t:${Math.floor(remindAt / 1000)}:R> 提醒你。`,
				flags: MessageFlags.Ephemeral,
			});

		} else if (subcommand === 'list') {
			const reminders = listReminders.all(interaction.user.id);

			if (reminders.length === 0) {
				return interaction.reply({ content: '你目前沒有任何提醒。', flags: MessageFlags.Ephemeral });
			}

			const embed = new EmbedBuilder()
				.setTitle('🔔 你的提醒列表')
				.setColor(0x00BFFF)
				.setTimestamp();

			for (const r of reminders.slice(0, MAX_EMBED_FIELDS)) {
				const time = `<t:${Math.floor(r.remind_at / 1000)}:R>`;
				embed.addFields({
					name: `#${r.id} (${r.method})`,
					value: `${r.message || '(無內容)'}\n🕒 ${time}`,
				});
			}

			if (reminders.length > MAX_EMBED_FIELDS) {
				embed.setFooter({ text: `僅顯示最近的 ${MAX_EMBED_FIELDS} 筆，共 ${reminders.length} 筆` });
			}

			return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });

		} else if (subcommand === 'delete') {
			const id = interaction.options.getInteger('id');
			const result = deleteReminder.run(id, interaction.user.id);

			if (result.changes === 0) {
				return interaction.reply({ content: '找不到這個提醒，或你無權刪除它。', flags: MessageFlags.Ephemeral });
			}

			return interaction.reply({ content: `✅ 提醒 #${id} 已刪除。`, flags: MessageFlags.Ephemeral });
		}
	},
};
