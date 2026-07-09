const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('顯示機器人的延遲'),
  async execute(interaction) {
    // 回覆一個延遲中的訊息（withResponse 取代已棄用的 fetchReply）
    const response = await interaction.reply({ content: '🏓 Ping...', withResponse: true });

    const sent = response.resource?.message;
    const latency = sent ? sent.createdTimestamp - interaction.createdTimestamp : interaction.client.ws.ping;
    const apiLatency = interaction.client.ws.ping;

    await interaction.editReply(`🏓 Pong!\n延遲：${latency}ms\nAPI 延遲：${apiLatency}ms`);
  },
};
