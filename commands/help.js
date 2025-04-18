const fs = require("fs");
const path = require("path");
const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("help")
    .setDescription("顯示所有可用的指令"),
  async execute(interaction) {
    const commandsPath = path.join(__dirname); // 目前這是 commands 資料夾
    const commandFiles = fs
      .readdirSync(commandsPath)
      .filter(file => file.endsWith(".js"));

    const fields = [];

    for (const file of commandFiles) {
      if (file === "help.js") continue; // 排除自己

      const command = require(path.join(commandsPath, file));
      if (command.data && command.data.name && command.data.description) {
        fields.push({
          name: `/${command.data.name}`,
          value: command.data.description,
        });
      }
    }

    const helpEmbed = new EmbedBuilder()
      .setColor(0x00bfff)
      .setTitle("🤖 可用指令列表")
      .setDescription("以下是所有可使用的指令：")
      .addFields(fields)
      .setFooter({ text: "使用 / 指令開始互動吧！" });

    await interaction.reply({ embeds: [helpEmbed], ephemeral: true });
  },
};
