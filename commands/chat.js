// commands/chat.js
const { SlashCommandBuilder } = require("discord.js");
const { getChatResponse } = require("../core/chat.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("chat")
    .setDescription("與 AI 對話")
    .addStringOption(option =>
      option.setName("message")
        .setDescription("你想問 AI 的內容")
        .setRequired(true)
    ),

  async execute(interaction) {
    const userMessage = interaction.options.getString("message");

    await interaction.deferReply();

    const response = await getChatResponse(userMessage);
    await interaction.editReply(response);
  }
};
