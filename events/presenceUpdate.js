const { Events } = require('discord.js');
const logger = require('../core/logger');

module.exports = {
  name: Events.PresenceUpdate,
  async execute(oldPresence, newPresence) {
    if (!logger.isPresenceLoggingAvailable()) return;

    const presence = newPresence || oldPresence;
    const guild = presence?.guild;
    if (!guild) return;

    // Presence payload 的 user 可能只有 ID；Partials.User 啟用時仍應讓 builder
    // 以可取得的資料建立日誌，而不是要求完整 GuildMember 一定存在。
    let user = newPresence?.user
      || newPresence?.member?.user
      || oldPresence?.user
      || oldPresence?.member?.user;
    if (user?.partial && presence.client?.users?.fetch) {
      try {
        user = await presence.client.users.fetch(user.id);
      } catch (err) {
        console.warn('[Logger] 無法取得 Presence 使用者資料：', err?.message || err);
      }
    }
    const settings = logger.getSettings(guild.id);
    if (logger.shouldIgnore(settings, 'presence', null, user)) return;

    const embed = logger.buildPresenceEmbed(oldPresence, newPresence);
    if (!embed) return; // 狀態沒變就不送
    await logger.sendLog(presence.client || guild.client, guild.id, embed);
  },
};
