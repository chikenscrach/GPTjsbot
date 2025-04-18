// commands/chat.js
const { SlashCommandBuilder } = require("discord.js");
const { getChatResponse } = require("../core/chat.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("chat")
    .setDescription("與 ChatGPT 聊天")
    .addStringOption(option =>
      option.setName("message")
        .setDescription("你想問 ChatGPT 的內容")
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName("model")
        .setDescription("選擇使用的模型")
        .setRequired(false)
        .addChoices(
          { name: "gpt-4o", value: "gpt-4o" },
          { name: "gpt-4o-mini", value: "gpt-4o-mini" },
          { name: "gpt-3.5-turbo", value: "gpt-3.5-turbo" }
        )
    ),

  async execute(interaction) {
    const userMessage = interaction.options.getString("message");
    const model = interaction.options.getString("model") || "gpt-3.5-turbo";

    await interaction.deferReply();

    const response = await getChatResponse(userMessage, model);
    await interaction.editReply(response);
  }
};
