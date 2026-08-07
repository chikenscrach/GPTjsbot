const { Events } = require('discord.js');
const logger = require('../core/logger');

module.exports = {
  name: Events.MessageUpdate,
  async execute(oldMessage, newMessage) {
    if (!oldMessage || !newMessage) return;

    // REST 只能取得「目前（更新後）」的訊息。可以 fetch newMessage，但絕不能
    // fetch oldMessage 再把結果當成舊版本，否則日誌會偽造出錯誤的修改前內容。
    if (newMessage.partial) {
      try {
        newMessage = await newMessage.fetch();
      }
      catch (err) {
        console.warn('[Logger] 無法取得更新後的訊息內容：', err?.message || err);
      }
    }

    const guild = newMessage.guild || oldMessage.guild || newMessage.channel?.guild || oldMessage.channel?.guild;
    if (!guild) return; // DM 不記錄

    // Fetch 後才判斷作者及排除頻道，讓 partial 能使用新取得的 metadata。
    const author = newMessage.author || oldMessage.author;
    const settings = logger.getSettings(guild.id);
    if (logger.shouldIgnore(settings, 'update', newMessage, author)) return;

    const embed = logger.buildMessageUpdateEmbed(oldMessage, newMessage);
    if (!embed) return;
    await logger.sendLog(newMessage.client || oldMessage.client || guild.client, guild.id, embed);
  },
};
