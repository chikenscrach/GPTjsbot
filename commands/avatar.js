const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('avatar')
		.setDescription('顯示使用者頭像')
		.addUserOption(option =>
			option.setName('target')
				.setDescription('要查看的使用者')
				.setRequired(true)),

	async execute(interaction) {
		const user = interaction.options.getUser('target');

		const embed = new EmbedBuilder()
			.setTitle(`${user.username} 的頭像`)
			.setImage(user.displayAvatarURL({ dynamic: true, size: 512 }))
			.setColor(0x00AE86);

		await interaction.reply({ embeds: [embed] });
	}
};
