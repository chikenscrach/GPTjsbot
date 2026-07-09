// commands/chat.js
const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const { getChatResponse } = require("../core/chat.js");

// 每位使用者的冷卻時間，避免短時間內大量呼叫 Groq API 消耗配額
const COOLDOWN_MS = 10 * 1000;
const cooldowns = new Map();

// 輔助函式：將過長的訊息安全地拆分成多個區塊，避免破壞 line-breaks
// 若斷點落在 ``` 程式碼區塊內，會自動補上閉合並在下一段重新開啟，維持排版
function splitMessage(text, maxLength = 1950) {
  const chunks = [];
  let currentChunk = "";
  let openFence = null; // 目前尚未閉合的 ``` 標記（含語言）

  const pushChunk = () => {
    const chunk = openFence ? currentChunk + "\n```" : currentChunk;
    if (chunk.trim()) chunks.push(chunk);
    currentChunk = openFence ? `${openFence}\n` : "";
  };

  for (const line of text.split("\n")) {
    const fence = line.match(/^\s*(```[^\s`]*)/);

    // 目前區塊放不下這一行時，先送出累積的內容（+5 預留閉合標記空間）
    if (currentChunk.length + line.length + 5 > maxLength) {
      pushChunk();
    }

    if (currentChunk.length + line.length + 5 > maxLength) {
      // 單行內容就超過 maxLength 的極端情況：硬切成多段
      let rest = line;
      while (currentChunk.length + rest.length + 5 > maxLength) {
        const available = maxLength - currentChunk.length - 5;
        currentChunk += rest.slice(0, available);
        rest = rest.slice(available);
        pushChunk();
      }
      currentChunk += rest + "\n";
    } else {
      currentChunk += line + "\n";
    }

    if (fence) {
      openFence = openFence ? null : fence[1];
    }
  }

  if (currentChunk.trim()) {
    pushChunk();
  }

  return chunks;
}

module.exports = {
  splitMessage,
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
    const now = Date.now();
    const lastUsed = cooldowns.get(interaction.user.id) ?? 0;

    if (now - lastUsed < COOLDOWN_MS) {
      return interaction.reply({
        content: `⏳ 指令冷卻中，請於 <t:${Math.ceil((lastUsed + COOLDOWN_MS) / 1000)}:R> 再試一次。`,
        flags: MessageFlags.Ephemeral,
      });
    }
    cooldowns.set(interaction.user.id, now);

    // 定期清理過期的冷卻記錄，避免 Map 無限增長
    if (cooldowns.size > 500) {
      for (const [id, ts] of cooldowns) {
        if (now - ts >= COOLDOWN_MS) cooldowns.delete(id);
      }
    }

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
