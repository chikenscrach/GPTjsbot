const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('顯示機器人的延遲'),
  async execute(interaction) {
    // 回覆一個延遲中的訊息
    const sent = await interaction.reply({ content: '🏓 Ping...', fetchReply: true });

    const latency = sent.createdTimestamp - interaction.createdTimestamp;
    const apiLatency = interaction.client.ws.ping;

    await interaction.editReply(`🏓 Pong!\n延遲：${latency}ms\nAPI 延遲：${apiLatency}ms`);
  },
};
