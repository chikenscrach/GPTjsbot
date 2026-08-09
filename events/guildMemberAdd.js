const { Events } = require('discord.js');
const logger = require('../core/logger');

module.exports = {
  name: Events.GuildMemberAdd,
  async execute(member) {
    if (!logger.isMemberLoggingAvailable() || !member?.guild) return;

    // GuildMember/User 可能是 partial；不在事件處理器事後 fetch，交由 builder
    // 使用現有 ID 與 metadata 安全呈現。
    const settings = logger.getSettings(member.guild.id);
    if (logger.shouldIgnore(settings, 'member_join', member, member.user)) return;

    const embed = logger.buildMemberJoinEmbed(member);
    if (!embed) return;
    await logger.sendLog(member.client || member.guild.client, member.guild.id, embed);
  },
};
