const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  MessageFlags,
  EmbedBuilder,
} = require('discord.js');
const logger = require('../core/logger');

const REQUIRED_LOG_CHANNEL_PERMISSIONS = [
  [PermissionFlagsBits.ViewChannel, '查看頻道'],
  [PermissionFlagsBits.SendMessages, '傳送訊息'],
  [PermissionFlagsBits.EmbedLinks, '嵌入連結'],
];

/**
 * 重新向 Discord 取得頻道並檢查 bot 的實際權限，避免把已刪除或無法
 * 傳送 Embed 的頻道寫入設定。
 */
async function validateLogChannel(interaction, channelId, fallbackChannel = null) {
  let channel;
  try {
    if (typeof interaction.guild.channels?.fetch === 'function') {
      channel = await interaction.guild.channels.fetch(channelId, { force: true });
    } else {
      channel = interaction.guild.channels?.cache?.get(channelId) || fallbackChannel;
    }
  } catch (err) {
    console.warn(`[Logger] 無法取得日誌頻道 ${channelId}：`, err?.message || err);
    channel = null;
  }

  if (!channel || (channel.guildId && channel.guildId !== interaction.guild.id)) {
    return { ok: false, reason: '❌ 找不到指定的日誌頻道；頻道可能已被刪除。' };
  }

  if (![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)) {
    return { ok: false, reason: '❌ 日誌只能傳送到伺服器文字或公告頻道。' };
  }
  if ((typeof channel.isSendable === 'function' && !channel.isSendable())
    || typeof channel.send !== 'function') {
    return { ok: false, reason: '❌ 指定的頻道目前無法傳送訊息。' };
  }

  let botMember = interaction.guild.members?.me;
  if (!botMember && typeof interaction.guild.members?.fetchMe === 'function') {
    try {
      botMember = await interaction.guild.members.fetchMe();
    } catch (err) {
      console.warn('[Logger] 無法取得 bot 成員資料：', err?.message || err);
    }
  }
  // permissionsFor 亦可接受 User；這可涵蓋極少數 members.me 尚未快取的情況。
  botMember ||= interaction.client?.user;

  const permissions = botMember && typeof channel.permissionsFor === 'function'
    ? channel.permissionsFor(botMember)
    : null;
  if (!permissions || typeof permissions.has !== 'function') {
    return { ok: false, reason: '❌ 無法確認 bot 在該頻道的權限，請稍後再試。' };
  }

  const missing = REQUIRED_LOG_CHANNEL_PERMISSIONS
    .filter(([permission]) => !permissions.has(permission))
    .map(([, label]) => label);
  if (missing.length > 0) {
    return {
      ok: false,
      reason: `❌ Bot 在 ${channel} 缺少以下權限：${missing.join('、')}。`,
    };
  }

  return { ok: true, channel };
}

/**
 * 保留完整的頻道 mention，並確保單一 Embed field 不超過 1024 字元。
 */
function formatExcludedChannels(channelIds) {
  if (channelIds.length === 0) return '*(無)*';

  const parts = [];
  for (let index = 0; index < channelIds.length; index += 1) {
    const mention = `<#${channelIds[index]}>`;
    const candidate = [...parts, mention].join(', ');
    const remaining = channelIds.length - index - 1;
    const suffix = remaining > 0 ? `，…另有 ${remaining} 個` : '';
    if (candidate.length + suffix.length > 1024) {
      const omitted = channelIds.length - index;
      const finalSuffix = `，…另有 ${omitted} 個`;
      return logger.truncate(`${parts.join(', ')}${finalSuffix}`, 1024);
    }
    parts.push(mention);
  }
  return parts.join(', ');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('logger')
    .setDescription('伺服器事件日誌設定（僅管理員可用）')
    // 先用 Discord 的預設權限控制顯示，再於 execute 內做不可被覆寫的執行期檢查。
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(sub =>
      sub
        .setName('enable')
        .setDescription('啟用日誌功能（須先設定頻道）')
    )
    .addSubcommand(sub =>
      sub
        .setName('disable')
        .setDescription('停用日誌功能')
    )
    .addSubcommand(sub =>
      sub
        .setName('set-channel')
        .setDescription('設定接收日誌訊息的頻道')
        .addChannelOption(opt =>
          opt
            .setName('channel')
            .setDescription('選擇一個文字或公告頻道')
            .setRequired(true)
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('toggle')
        .setDescription('開關個別事件類型的記錄')
        .addStringOption(opt =>
          opt
            .setName('event')
            .setDescription('要切換的事件類型')
            .setRequired(true)
            .addChoices(
              { name: '上線狀態變更 (presence)', value: 'log_presence' },
              { name: '訊息刪除 (delete)', value: 'log_message_delete' },
              { name: '訊息編輯 (update)', value: 'log_message_update' },
              { name: '成員加入 (member join)', value: 'log_member_join' },
              { name: '成員離開 (member leave)', value: 'log_member_leave' },
              { name: '語音頻道移動 (voice)', value: 'log_voice' },
            )
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('exclude-channel')
        .setDescription('新增或移除「不記錄訊息／語音事件」的頻道或分類')
        .addChannelOption(opt =>
          opt
            .setName('channel')
            .setDescription('要切換訊息／語音事件排除設定的頻道或分類')
            .setRequired(true)
            .addChannelTypes(
              ChannelType.GuildText,
              ChannelType.GuildAnnouncement,
              ChannelType.GuildVoice,
              ChannelType.GuildStageVoice,
              ChannelType.PublicThread,
              ChannelType.PrivateThread,
              ChannelType.AnnouncementThread,
              ChannelType.GuildForum,
              ChannelType.GuildMedia,
              ChannelType.GuildCategory,
            )
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('exclude-bots')
        .setDescription('切換是否記錄機器人產生的事件')
    )
    .addSubcommand(sub =>
      sub
        .setName('status')
        .setDescription('檢視目前日誌設定')
    ),

  async execute(interaction) {
    if (!interaction.guild) {
      return interaction.reply({ content: '❗ 這個指令只能在伺服器中使用。', flags: MessageFlags.Ephemeral });
    }

    const memberPermissions = interaction.memberPermissions || interaction.member?.permissions;
    if (!memberPermissions?.has?.(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({
        content: '❌ 你需要「管理伺服器」權限才能使用這個指令。',
        flags: MessageFlags.Ephemeral,
      });
    }

    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    switch (sub) {
      case 'enable': {
        const settings = logger.getSettings(guildId);
        if (!settings.channel_id) {
          return interaction.reply({
            content: '❌ 尚未設定日誌頻道，請先用 `/logger set-channel` 指定一個頻道。',
            flags: MessageFlags.Ephemeral,
          });
        }
        const validation = await validateLogChannel(interaction, settings.channel_id);
        if (!validation.ok) {
          return interaction.reply({ content: validation.reason, flags: MessageFlags.Ephemeral });
        }
        logger.updateSetting(guildId, { enabled: 1 });
        return interaction.reply({
          content: `✅ 日誌功能已啟用，紀錄將送往 ${validation.channel}。`,
          flags: MessageFlags.Ephemeral,
        });
      }

      case 'disable': {
        logger.updateSetting(guildId, { enabled: 0 });
        return interaction.reply({
          content: '🛑 日誌功能已停用。',
          flags: MessageFlags.Ephemeral,
        });
      }

      case 'set-channel': {
        const selectedChannel = interaction.options.getChannel('channel');
        if (!selectedChannel) {
          return interaction.reply({
            content: '❌ 找不到指定的日誌頻道。',
            flags: MessageFlags.Ephemeral,
          });
        }
        const validation = await validateLogChannel(interaction, selectedChannel.id, selectedChannel);
        if (!validation.ok) {
          return interaction.reply({ content: validation.reason, flags: MessageFlags.Ephemeral });
        }
        const channel = validation.channel;
        logger.updateSetting(guildId, { channel_id: channel.id });
        // 若已啟用，不影響啟用狀態；未啟用則需使用者自行啟用
        return interaction.reply({
          content: `📡 日誌頻道已設定為 ${channel}。\n請使用 \`/logger enable\` 啟用日誌功能（若尚未啟用）。`,
          flags: MessageFlags.Ephemeral,
        });
      }

      case 'toggle': {
        const eventKey = interaction.options.getString('event');
        const eventLabels = {
          log_presence: '上線狀態變更',
          log_message_delete: '訊息刪除',
          log_message_update: '訊息編輯',
          log_member_join: '成員加入',
          log_member_leave: '成員離開',
          log_voice: '語音頻道移動',
        };
        if (!Object.hasOwn(eventLabels, eventKey)) {
          return interaction.reply({
            content: '❌ 未知的事件類型。',
            flags: MessageFlags.Ephemeral,
          });
        }
        const settings = logger.getSettings(guildId);
        const current = settings[eventKey] ? 0 : 1;
        if (eventKey === 'log_presence'
          && current === 1
          && !logger.isPresenceLoggingAvailable()) {
          return interaction.reply({
            content: '❌ 上線狀態日誌目前不可用；部署環境必須先將 `LOGGER_PRESENCE_ENABLED` 設為 `true`，並啟用 Discord Presence 與 Server Members Intents。',
            flags: MessageFlags.Ephemeral,
          });
        }
        if (['log_member_join', 'log_member_leave'].includes(eventKey)
          && current === 1
          && !logger.isMemberLoggingAvailable()) {
          return interaction.reply({
            content: '❌ 成員加入／離開日誌目前不可用；部署環境必須先將 `LOGGER_MEMBERS_ENABLED` 設為 `true`，並啟用 Discord Server Members Intent。',
            flags: MessageFlags.Ephemeral,
          });
        }
        logger.updateSetting(guildId, { [eventKey]: current });
        return interaction.reply({
          content: `🔄 「${eventLabels[eventKey]}」日誌已${current ? '啟用' : '停用'}。`,
          flags: MessageFlags.Ephemeral,
        });
      }

      case 'exclude-channel': {
        const channel = interaction.options.getChannel('channel');
        if (!channel || (channel.guildId && channel.guildId !== guildId)) {
          return interaction.reply({
            content: '❌ 找不到指定的排除頻道。',
            flags: MessageFlags.Ephemeral,
          });
        }
        const settings = logger.getSettings(guildId);
        const list = logger.getExcludedChannels(settings);
        let newList;
        let action;
        if (list.includes(channel.id)) {
          newList = list.filter(id => id !== channel.id);
          action = '已從排除清單移除';
        } else {
          newList = [...list, channel.id];
          action = '已加入排除清單';
        }
        logger.updateSetting(guildId, { exclude_channels: newList.join(',') });
        return interaction.reply({
          content: `🚫 ${channel} ${action}。目前共排除 ${newList.length} 個頻道。`,
          flags: MessageFlags.Ephemeral,
        });
      }

      case 'exclude-bots': {
        const settings = logger.getSettings(guildId);
        const next = settings.exclude_bots ? 0 : 1;
        logger.updateSetting(guildId, { exclude_bots: next });
        return interaction.reply({
          content: `🤖 機器人事件${next ? '已設為不記錄' : '已設為會記錄'}。`,
          flags: MessageFlags.Ephemeral,
        });
      }

      case 'status': {
        const settings = logger.getSettings(guildId);
        const excludedList = logger.getExcludedChannels(settings);
        const presenceAvailable = logger.isPresenceLoggingAvailable();
        const memberAvailable = logger.isMemberLoggingAvailable();
        const channelText = settings.channel_id
          ? `<#${settings.channel_id}>`
          : '*(未設定)*';
        const embed = new EmbedBuilder()
          .setColor(logger.COLORS.info)
          .setTitle('📋 伺服器日誌設定')
          .addFields(
            { name: '狀態', value: settings.enabled ? '🟢 已啟用' : '🔴 已停用', inline: true },
            { name: '日誌頻道', value: channelText, inline: true },
            { name: '\u200B', value: '\u200B', inline: true },
            {
              name: '上線狀態',
              value: presenceAvailable
                ? (settings.log_presence ? '✅ 記錄' : '❌ 不記錄')
                : '⚠️ 不可用（環境未啟用）',
              inline: true,
            },
            { name: '訊息刪除', value: settings.log_message_delete ? '✅ 記錄' : '❌ 不記錄', inline: true },
            { name: '訊息編輯', value: settings.log_message_update ? '✅ 記錄' : '❌ 不記錄', inline: true },
            {
              name: '成員加入',
              value: memberAvailable
                ? (settings.log_member_join ? '✅ 記錄' : '❌ 不記錄')
                : '⚠️ 不可用（環境未啟用）',
              inline: true,
            },
            {
              name: '成員離開',
              value: memberAvailable
                ? (settings.log_member_leave ? '✅ 記錄' : '❌ 不記錄')
                : '⚠️ 不可用（環境未啟用）',
              inline: true,
            },
            { name: '語音頻道移動', value: settings.log_voice ? '✅ 記錄' : '❌ 不記錄', inline: true },
            { name: '排除機器人', value: settings.exclude_bots ? '是' : '否', inline: true },
            {
              name: `排除頻道 (${excludedList.length})`,
              value: formatExcludedChannels(excludedList),
              inline: false,
            },
          )
          .setTimestamp();
        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      }

      default:
        return interaction.reply({ content: '未知的子指令。', flags: MessageFlags.Ephemeral });
    }
  },
};
