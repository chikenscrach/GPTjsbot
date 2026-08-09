const { Events } = require('discord.js');
const logger = require('../core/logger');

module.exports = {
  name: Events.VoiceStateUpdate,
  async execute(oldState, newState) {
    if (!oldState || !newState) return;

    const oldChannelId = oldState.channelId ?? oldState.channel?.id ?? null;
    const newChannelId = newState.channelId ?? newState.channel?.id ?? null;

    // 忽略靜音、耳機、串流等同頻道狀態變更；只記錄加入、離開與移動。
    if (oldChannelId === newChannelId) return;

    const guild = newState.guild || oldState.guild;
    if (!guild) return;

    const settings = logger.getSettings(guild.id);
    const user = newState.member?.user || oldState.member?.user;
    if (logger.shouldIgnore(settings, 'voice', null, user)) return;

    // 只要來源或目的頻道（含其 category）在排除清單中，就抑制整筆移動，
    // 避免日誌從另一端洩漏受排除頻道的存在或成員活動。
    const oldChannel = oldState.channel || oldChannelId;
    const newChannel = newState.channel || newChannelId;
    if ((oldChannel && logger.isExcludedChannel(settings, oldChannel, guild))
      || (newChannel && logger.isExcludedChannel(settings, newChannel, guild))) {
      return;
    }

    const embed = logger.buildVoiceStateEmbed(oldState, newState);
    if (!embed) return;
    await logger.sendLog(newState.client || oldState.client || guild.client, guild.id, embed);
  },
};
