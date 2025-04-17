const { SlashCommandBuilder } = require('discord.js');
const os = require('os');

function formatUptime(seconds) {
	const days = Math.floor(seconds / (3600 * 24));
	seconds %= 3600 * 24;
	const hours = Math.floor(seconds / 3600);
	seconds %= 3600;
	const minutes = Math.floor(seconds / 60);
	seconds = Math.floor(seconds % 60);
	return `${days}天 ${hours}小時 ${minutes}分 ${seconds}秒`;
}

module.exports = {
	data: new SlashCommandBuilder()
		.setName('status')
		.setDescription('檢查機器人運行狀態'),
	async execute(interaction) {
		const uptime = formatUptime(process.uptime());
		const memoryUsage = process.memoryUsage().heapUsed / 1024 / 1024; // MB
		const ownerId = process.env.BOT_OWNER_ID;

		let ownerTag = '無法取得';
		try {
			const user = await interaction.client.users.fetch(ownerId);
			ownerTag = `${user.username}#${user.discriminator}`;
		} catch (err) {
			console.error('❌ 無法取得 owner 資訊：', err);
		}

		await interaction.reply({
			embeds: [
				{
					color: 0x00ccff,
					title: '🤖 機器人狀態',
					fields: [
						{ name: '⏱️ Uptime', value: uptime, inline: true },
						{ name: '🧠 記憶體使用', value: `${memoryUsage.toFixed(2)} MB`, inline: true },
						{ name: '👑 Owner', value: `<@${ownerId}> (${ownerTag})`, inline: false },
						{ name: '🌐 伺服器數量', value: `${interaction.client.guilds.cache.size} 個伺服器`, inline: true }
					],
					timestamp: new Date().toISOString()
				}
			]
		});
	}
};
