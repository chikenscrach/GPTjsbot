const { Events } = require('discord.js');
const logger = require('../core/logger');

module.exports = {
  name: Events.MessageBulkDelete,
  async execute(messages, channel) {
    if (!messages || messages.size === 0) return;

    const firstMessage = typeof messages.first === 'function'
      ? messages.first()
      : messages.values().next().value;
    const guild = channel?.guild || firstMessage?.guild || firstMessage?.channel?.guild;
    if (!guild) return; // DM 不記錄

    const settings = logger.getSettings(guild.id);
    const embeds = [];

    for (const message of messages.values()) {
      if (!message || logger.shouldIgnore(settings, 'delete', message, message.author)) continue;

      const embed = logger.buildMessageDeleteEmbed(message);
      if (embed) embeds.push(embed);
    }

    if (embeds.length === 0) return;
    await logger.sendLogs(channel?.client || firstMessage?.client || guild.client, guild.id, embeds);
  },
};
