// commands/chat.js
const { SlashCommandBuilder } = require("discord.js");
const { getChatResponse } = require("../core/chat.js");

// 輔助函式：將過長的訊息安全地拆分成多個區塊，避免破壞 line-breaks
function splitMessage(text, maxLength = 1950) {
  const chunks = [];
  let currentChunk = "";
  
  // 以換行符號為基礎進行分割，能較好地保留文章段落
  const lines = text.split("\n");
  
  for (const line of lines) {
    // 遇到單行內容直接大於 maxLength 的極端情況
    if (line.length > maxLength) {
      if (currentChunk.trim()) {
        chunks.push(currentChunk);
        currentChunk = "";
      }
      
      let tempLine = line;
      while (tempLine.length > maxLength) {
        chunks.push(tempLine.slice(0, maxLength));
        tempLine = tempLine.slice(maxLength);
      }
      currentChunk = tempLine + "\n";
    } else if (currentChunk.length + line.length + 1 > maxLength) {
      chunks.push(currentChunk);
      currentChunk = line + "\n";
    } else {
      currentChunk += line + "\n";
    }
  }
  
  if (currentChunk.trim()) {
    chunks.push(currentChunk);
  }
  
  return chunks;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("chat")
    .setDescription("與 AI 對話")
    .addStringOption(option =>
      option.setName("message")
        .setDescription("你想問 AI 的內容")
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName("model")
        .setDescription("選擇使用的 AI 模型（預設為環境變數設定）")
        .setRequired(false)
        .addChoices(
          { name: "Llama 3.3 70B (強大通用 - 生產級)", value: "llama-3.3-70b-versatile" },
          { name: "Llama 3.1 8B (極速輕量 - 生產級)", value: "llama-3.1-8b-instant" },
          { name: "GPT OSS 120B (大型開源 - 生產級)", value: "openai/gpt-oss-120b" },
          { name: "GPT OSS 20B (極速智能 - 生產級)", value: "openai/gpt-oss-20b" },
          { name: "Qwen 3.6 27B (通義千問 - 預覽版)", value: "qwen/qwen3.6-27b" },
          { name: "Qwen 3 32B (智慧中樞 - 預覽版)", value: "qwen/qwen3-32b" },
          { name: "Llama 4 Scout 17B (最新架構 - 預覽版)", value: "meta-llama/llama-4-scout-17b-16e-instruct" }
        )
    ),

  async execute(interaction) {
    const userMessage = interaction.options.getString("message");
    const chosenModel = interaction.options.getString("model") || process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

    await interaction.deferReply();

    const response = await getChatResponse(userMessage, chosenModel);
    
    // 檢查字數，若超過 Discord 2000 字元限制則分段發送
    if (response.length <= 2000) {
      await interaction.editReply(response);
    } else {
      const chunks = splitMessage(response, 1950);
      
      // 第一段使用 editReply
      await interaction.editReply(chunks[0]);
      
      // 之後的段落使用 followUp 發送
      for (let i = 1; i < chunks.length; i++) {
        // 加上些微延遲防範 Discord 速率限制 (Rate limit)
        await new Promise(resolve => setTimeout(resolve, 500));
        await interaction.followUp(chunks[i]);
      }
    }
  }
};
