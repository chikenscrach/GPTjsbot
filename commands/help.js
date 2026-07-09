const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("help")
    .setDescription("顯示所有可用的指令"),
  async execute(interaction) {
    // 指令啟動時已載入 client.commands，直接使用即可，不必重新掃描檔案
    const fields = interaction.client.commands
      .filter(command => command.data.name !== "help")
      .map(command => ({
        name: `/${command.data.name}`,
        value: command.data.description,
      }));

    const helpEmbed = new EmbedBuilder()
      .setColor(0x00bfff)
      .setTitle("🤖 可用指令列表")
      .setDescription("以下是所有可使用的指令：")
      .addFields(fields)
      .setFooter({ text: "使用 / 指令開始互動吧！" });

    await interaction.reply({ embeds: [helpEmbed], flags: MessageFlags.Ephemeral });
  },
};
