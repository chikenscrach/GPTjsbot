const { SlashCommandBuilder, InteractionContextType, MessageFlags, time } = require('discord.js');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('info')
		.setDescription('取得使用者或伺服器的詳細資訊')
		.setContexts(InteractionContextType.Guild)
		.addStringOption(option =>
			option.setName('target')
				.setDescription('你想查詢什麼？')
				.setRequired(true)
				.addChoices(
					{ name: '使用者', value: 'user' },
					{ name: '伺服器', value: 'server' }
				)
		)
		.addUserOption(option =>
			option.setName('user')
				.setDescription('選擇一位使用者（僅在查詢使用者時需要）')
		),

	async execute(interaction) {
		if (!interaction.guild) {
			return interaction.reply({ content: '❗ 這個指令只能在伺服器中使用。', flags: MessageFlags.Ephemeral });
		}

		const target = interaction.options.getString('target');

		if (target === 'user') {
			const user = interaction.options.getUser('user');

			if (!user) {
				return interaction.reply({ content: '❗ 你必須選擇一位使用者。', flags: MessageFlags.Ephemeral });
			}

			const member = interaction.guild.members.cache.get(user.id);

			const userInfo = [
				`👤 使用者名稱：${user.username}`,
				`🪪 顯示名稱：${user.globalName || '無'}`,
				`🆔 ID：${user.id}`,
				`🤖 是否為機器人：${user.bot ? '是' : '否'}`,
				`📅 帳號建立時間：${time(user.createdAt, 'F')}`,
			];

			if (member) {
				userInfo.push(
					`📛 暱稱：${member.nickname || '無'}`,
					`📥 加入伺服器時間：${time(member.joinedAt, 'F')}`,
					`🎭 身分組：${member.roles.cache.map(r => r.name).join(', ')}`,
				);
			}

			await interaction.reply({ content: userInfo.join('\n') });

		} else if (target === 'server') {
			const guild = interaction.guild;

			const guildInfo = [
				`🏠 伺服器名稱：${guild.name}`,
				`🆔 ID：${guild.id}`,
				`👑 擁有者 ID：${guild.ownerId}`,
				`✅ 是否已驗證伺服器：${guild.verified ? '是' : '否'}`,
				`👥 成員總數：${guild.memberCount}`,
				`📅 創建時間：${time(guild.createdAt, 'F')}`,
				`🌐 地區（語言）：${guild.preferredLocale}`,
				`🧱 類型：${guild.large ? '大型伺服器' : '一般伺服器'}`,
				`📁 頻道數量：${guild.channels.cache.size}`,
				`🎭 身分組數量：${guild.roles.cache.size}`,
			];

			await interaction.reply({ content: guildInfo.join('\n') });
		}
	},
};
