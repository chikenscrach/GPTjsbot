const { Events } = require('discord.js');
const logger = require('../core/logger');

module.exports = {
  name: Events.GuildMemberRemove,
  async execute(member) {
    if (!logger.isMemberLoggingAvailable() || !member?.guild) return;

    // 已離開伺服器的 partial member 不一定能再 fetch；保留可取得的資料記錄。
    const settings = logger.getSettings(member.guild.id);
    if (logger.shouldIgnore(settings, 'member_leave', member, member.user)) return;

    const embed = logger.buildMemberRemoveEmbed(member);
    if (!embed) return;
    await logger.sendLog(member.client || member.guild.client, member.guild.id, embed);
  },
};
