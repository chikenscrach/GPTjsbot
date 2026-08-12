// commands/summarize.js
const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require("discord.js");
const { fetchSummary, SummarizeError } = require("../core/summarize.js");
const { splitMessage } = require("../utils/split-message.js");

// 每位使用者的冷卻時間。摘要一次要抓網頁＋跑模型，比 /chat 貴，冷卻設長一點。
const COOLDOWN_MS = 30 * 1000;
const cooldowns = new Map();

// Discord 限制：embed description 上限 4096、title 上限 256。
// 摘要通常在 3000 字元內，多數情況一個 embed 就裝得下，不必像純文字那樣切到 2000。
const EMBED_DESCRIPTION_LIMIT = 4000;
const EMBED_TITLE_LIMIT = 250;
const MAX_EMBEDS_PER_MESSAGE = 10;
const MAX_EMBED_TOTAL_CHARACTERS = 6000;

function countEmbedCharacters(embed) {
  const data = typeof embed?.toJSON === "function"
    ? embed.toJSON()
    : (embed?.data || embed || {});
  let count = 0;
  count += data.title?.length || 0;
  count += data.description?.length || 0;
  count += data.author?.name?.length || 0;
  count += data.footer?.text?.length || 0;

  if (Array.isArray(data.fields)) {
    for (const field of data.fields) {
      count += field.name?.length || 0;
      count += field.value?.length || 0;
    }
  }

  return count;
}

function batchEmbeds(embeds) {
  const batches = [];
  let batch = [];
  let batchCharacters = 0;

  for (const embed of embeds) {
    const embedCharacters = countEmbedCharacters(embed);
    if (embedCharacters > MAX_EMBED_TOTAL_CHARACTERS) {
      throw new RangeError(`單一 embed 超過 Discord ${MAX_EMBED_TOTAL_CHARACTERS} 字元上限`);
    }

    const exceedsCount = batch.length >= MAX_EMBEDS_PER_MESSAGE;
    const exceedsCharacters = batch.length > 0
      && batchCharacters + embedCharacters > MAX_EMBED_TOTAL_CHARACTERS;

    if (exceedsCount || exceedsCharacters) {
      batches.push(batch);
      batch = [];
      batchCharacters = 0;
    }

    batch.push(embed);
    batchCharacters += embedCharacters;
  }

  if (batch.length > 0) batches.push(batch);
  return batches;
}

function buildEmbeds({ title, summary, url, truncated }) {
  const chunks = splitMessage(summary, EMBED_DESCRIPTION_LIMIT);
  if (chunks.length === 0) chunks.push("（沒有產生任何內容）");

  return chunks.map((chunk, index) => {
    const embed = new EmbedBuilder().setColor(0x00bfff).setDescription(chunk);

    // 只有第一個 embed 帶標題與連結，後續的純粹是內容延續
    if (index === 0) {
      const heading = title || new URL(url).hostname;
      embed.setTitle(
        heading.length > EMBED_TITLE_LIMIT
          ? `${heading.slice(0, EMBED_TITLE_LIMIT - 1)}…`
          : heading,
      );
      // 設了 URL，標題就會變成可點擊的連結
      embed.setURL(url);
    }

    if (index === chunks.length - 1 && truncated) {
      embed.setFooter({ text: "⚠️ 原文過長，摘要僅涵蓋前半部內容" });
    }

    return embed;
  });
}

module.exports = {
  batchEmbeds,
  buildEmbeds,
  countEmbedCharacters,
  data: new SlashCommandBuilder()
    .setName("summarize")
    .setDescription("抓取網頁內容並用 AI 整理重點")
    .addStringOption(option =>
      option.setName("url")
        .setDescription("要分析的網址（http:// 或 https://）")
        .setRequired(true)
    )
    .addBooleanOption(option =>
      option.setName("private")
        .setDescription("只有你看得到結果（預設關閉）")
        .setRequired(false)
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

    const url = interaction.options.getString("url");
    const isPrivate = interaction.options.getBoolean("private") ?? false;

    // 整個流程要跑數十秒，但 slash 指令必須 3 秒內回應，所以先 defer。
    // defer 之後有 15 分鐘可以用 editReply 補送結果。
    await interaction.deferReply(isPrivate ? { flags: MessageFlags.Ephemeral } : {});

    let result;
    try {
      result = await fetchSummary(url, interaction.user.id);
    } catch (error) {
      if (error instanceof SummarizeError) {
        const hint = error.retryable ? "\n稍後再試一次可能就會成功。" : "";
        await interaction.editReply(`❌ ${error.message}${hint}`);
        return;
      }
      throw error; // 非預期的錯誤交給 index.js 的統一處理
    }

    const embedBatches = batchEmbeds(buildEmbeds(result));

    // Discord 單則訊息最多 10 個 embed，且所有 embed 合計最多 6000 字元。
    await interaction.editReply({ embeds: embedBatches[0] });

    for (let i = 1; i < embedBatches.length; i++) {
      // 加上些微延遲防範 Discord 速率限制 (Rate limit)
      await new Promise(resolve => setTimeout(resolve, 500));
      await interaction.followUp({
        embeds: embedBatches[i],
        ...(isPrivate ? { flags: MessageFlags.Ephemeral } : {}),
      });
    }
  }
};
