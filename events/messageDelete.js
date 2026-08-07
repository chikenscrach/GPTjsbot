const { Events } = require('discord.js');
const logger = require('../core/logger');

module.exports = {
  name: Events.MessageDelete,
  async execute(message) {
    if (!message) return;

    // 已刪除的 partial 訊息無法再由 REST 取回；保留它仍帶有的 ID、頻道等
    // metadata 交給 builder 呈現，內容未知時不得假裝已取得完整原文。
    const guild = message.guild || message.channel?.guild;
    if (!guild) return; // DM 不記錄

    const settings = logger.getSettings(guild.id);
    if (logger.shouldIgnore(settings, 'delete', message, message.author)) return;

    const embed = logger.buildMessageDeleteEmbed(message);
    if (!embed) return;
    await logger.sendLog(message.client || guild.client, guild.id, embed);
  },
};
