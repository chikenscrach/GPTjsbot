const { EmbedBuilder, time, TimestampStyles } = require('discord.js');
const db = require('./db');

// 事件顏色（Embed 側邊色條）
const COLORS = {
  online: 0x57F287,   // 綠
  offline: 0xED4245,   // 紅
  idle: 0xFEE75C,      // 黃
  dnd: 0xFEE75C,       // 黃
  delete: 0xED4245,    // 紅
  update: 0xFEE75C,    // 黃
  memberJoin: 0x57F287,
  memberLeave: 0xED4245,
  voice: 0x5865F2,
  info: 0x00ccff,      // 藍
};

// Embed 欄位單格上限（Discord 限制）
const EMBED_FIELD_MAX = 1024;
// 安全截斷長度，預留「…(已截斷)」後綴
const SAFE_MAX = 1000;
const MAX_EMBEDS_PER_MESSAGE = 10;
const MAX_EMBED_TOTAL_CHARACTERS = 6000;

// 可由 updateSetting 修改的資料庫欄位。不可讓呼叫端把欄位名稱直接插入 SQL。
const LOGGER_SETTING_FIELDS = new Set([
  'channel_id',
  'enabled',
  'log_presence',
  'log_message_delete',
  'log_message_update',
  'log_member_join',
  'log_member_leave',
  'log_voice',
  'exclude_channels',
  'exclude_bots',
]);

/**
 * 取得指定伺服器的日誌設定（若不存在則寫入預設值）
 * @param {string} guildId
 * @returns {{guild_id:string, channel_id:string|null, enabled:number, log_presence:number, log_message_delete:number, log_message_update:number, log_member_join:number, log_member_leave:number, log_voice:number, exclude_channels:string, exclude_bots:number}}
 */
function getSettings(guildId) {
  let row = db.prepare('SELECT * FROM logger_settings WHERE guild_id = ?').get(guildId);
  if (!row) {
    db.prepare(`
      INSERT INTO logger_settings (guild_id, enabled, updated_at)
      VALUES (?, 0, ?)
    `).run(guildId, Date.now());
    row = db.prepare('SELECT * FROM logger_settings WHERE guild_id = ?').get(guildId);
  }
  return row;
}

/**
 * 更新指定欄位
 */
function updateSetting(guildId, patch) {
  const fields = Object.keys(patch);
  if (fields.length === 0) return;
  const invalidFields = fields.filter(field => !LOGGER_SETTING_FIELDS.has(field));
  if (invalidFields.length > 0) {
    throw new TypeError(`不允許更新 logger_settings 欄位：${invalidFields.join(', ')}`);
  }
  getSettings(guildId); // 確保資料列存在
  const sets = fields.map(f => `${f} = ?`).join(', ');
  const values = fields.map(f => patch[f]);
  db.prepare(`UPDATE logger_settings SET ${sets}, updated_at = ? WHERE guild_id = ?`)
    .run(...values, Date.now(), guildId);
}

/**
 * 將字串截斷為安全長度，避免 Embed 欄位超過 1024 字元上限
 */
function truncate(text, max = SAFE_MAX) {
  if (!text) return '';
  if (text.length <= max) return text;
  const suffix = '…(已截斷)';
  if (max <= suffix.length) return text.slice(0, max);
  return text.slice(0, max - suffix.length) + suffix;
}

/**
 * 將訊息內容整理成可讀字串（含附件資訊）
 */
function describeContent(message) {
  const parts = [];
  if (message.content) parts.push(message.content);
  if (message.attachments?.size > 0) {
    const files = Array.from(message.attachments.values())
      .map(attachment => attachment.url || attachment.proxyURL || attachment.name)
      .filter(Boolean);
    if (files.length) parts.push(`📎 附件：\n${files.join('\n')}`);
  }
  if (Array.isArray(message.embeds) && message.embeds.length > 0) {
    parts.push(`🧩 Embed 數量：${message.embeds.length}`);
  }
  if (message.stickers && message.stickers.size > 0) {
    const stickers = Array.from(message.stickers.values())
      .map(sticker => {
        if (sticker.name && sticker.id) return `${sticker.name} (${sticker.id})`;
        return sticker.name || sticker.id;
      })
      .filter(Boolean);
    if (stickers.length) parts.push(`🎫 貼圖：${stickers.join(', ')}`);
  }
  return parts.join('\n') || '(無文字內容)';
}

/**
 * 比較使用者可編輯的訊息內容。Discord 會因連結預覽、pin 等系統變化
 * 發出 MessageUpdate；這些只有 Embed metadata 改變的事件不應視為使用者編輯。
 */
function editableContentFingerprint(message) {
  if (!message || message.partial || typeof message.content !== 'string') return null;

  const attachments = message.attachments?.values
    ? Array.from(message.attachments.values())
      .map(attachment => attachment.id || attachment.url || attachment.proxyURL || attachment.name)
      .filter(Boolean)
      .sort()
    : [];
  const stickers = message.stickers?.values
    ? Array.from(message.stickers.values())
      .map(sticker => sticker.id || sticker.name)
      .filter(Boolean)
      .sort()
    : [];

  return JSON.stringify([message.content, attachments, stickers]);
}

/**
 * 取得排除頻道清單（陣列）
 */
function getExcludedChannels(settings) {
  if (!settings?.exclude_channels) return [];
  return settings.exclude_channels.split(',').map(s => s.trim()).filter(Boolean);
}

/**
 * 判斷頻道或其父層頻道／分類是否在排除清單內。
 * @param {object} settings logger_settings 資料列
 * @param {string|object|null} channelOrId Discord 頻道或頻道 ID
 * @param {object|null} guild 可選的 Discord Guild，用來解析只有 ID 的頻道
 * @returns {boolean}
 */
function isExcludedChannel(settings, channelOrId, guild = null) {
  const excludes = new Set(getExcludedChannels(settings));
  if (excludes.size === 0 || !channelOrId) return false;

  const suppliedChannel = typeof channelOrId === 'object' ? channelOrId : null;
  const channelId = suppliedChannel?.id || String(channelOrId);
  if (excludes.has(channelId)) return true;

  const sourceGuild = guild || suppliedChannel?.guild || null;
  let channel = suppliedChannel
    || sourceGuild?.channels?.cache?.get(channelId)
    || sourceGuild?.channels?.resolve?.(channelId)
    || null;
  const visited = new Set([channelId]);

  // 兩層足以涵蓋一般頻道 -> category，以及 thread -> forum/text -> category。
  for (let depth = 0; channel && depth < 2; depth += 1) {
    const parentId = channel.parentId || channel.parent?.id;
    if (!parentId || visited.has(parentId)) break;
    if (excludes.has(parentId)) return true;
    visited.add(parentId);
    channel = channel.parent
      || sourceGuild?.channels?.cache?.get(parentId)
      || sourceGuild?.channels?.resolve?.(parentId)
      || null;
  }
  return false;
}

/**
 * 判斷是否應該忽略此事件。
 * @param {object} settings logger_settings 資料列
 * @param {'presence'|'delete'|'update'|'member_join'|'member_leave'|'voice'} event
 * @param {object|null} message 訊息；非訊息事件可傳 null
 * @param {object|null} user Discord User，用於排除 bot
 * @returns {boolean}
 */
function shouldIgnore(settings, event, message = null, user = null) {
  if (!settings.enabled) return true;
  if (event === 'presence' && !settings.log_presence) return true;
  if (event === 'delete' && !settings.log_message_delete) return true;
  if (event === 'update' && !settings.log_message_update) return true;
  if (event === 'member_join' && !settings.log_member_join) return true;
  if (event === 'member_leave' && !settings.log_member_leave) return true;
  if (event === 'voice' && !settings.log_voice) return true;

  if (settings.exclude_bots) {
    const eventUser = user || message?.author || message?.user || message?.member?.user;
    if (eventUser?.bot) return true;
  }

  if (message && isExcludedChannel(
    settings,
    message.channel || message.channelId,
    message.guild || message.channel?.guild,
  )) {
    return true;
  }
  return false;
}

/**
 * 計算單一 Embed 會計入 Discord 6000 字元總上限的字元數。
 */
function countEmbedCharacters(embed) {
  const data = typeof embed?.toJSON === 'function'
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

/**
 * 將一批日誌送到設定好的頻道，遵守每則訊息最多 10 個 Embed、
 * 所有 Embed 合計最多 6000 字元的 Discord 限制。
 */
async function sendLogs(client, guildId, embeds) {
  const pending = (Array.isArray(embeds) ? embeds : [embeds]).filter(Boolean);
  if (pending.length === 0) return;

  const settings = getSettings(guildId);
  if (!settings.enabled || !settings.channel_id) {
    if (!settings.channel_id) {
      console.warn(`[Logger] 伺服器 ${guildId} 尚未設定日誌頻道`);
    }
    return;
  }
  try {
    const channel = await client.channels.fetch(settings.channel_id);
    const isSendable = channel
      && channel.guildId === guildId
      && (typeof channel.isSendable !== 'function' || channel.isSendable())
      && typeof channel.send === 'function';
    if (!isSendable) {
      console.warn(`[Logger] 頻道 ${settings.channel_id} 不存在或無法傳送訊息`);
      return;
    }

    const batches = [];
    let batch = [];
    let batchCharacters = 0;

    for (const embed of pending) {
      const embedCharacters = countEmbedCharacters(embed);
      if (embedCharacters > MAX_EMBED_TOTAL_CHARACTERS) {
        console.warn(`[Logger] 略過超過 ${MAX_EMBED_TOTAL_CHARACTERS} 字元的 Embed`);
        continue;
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

    for (const embedBatch of batches) {
      await channel.send({ embeds: embedBatch });
    }
  } catch (err) {
    console.error(`[Logger] 發送日誌失敗：`, err?.message || err);
  }
}

/**
 * 將單一日誌送出；保留既有介面並委派給批次實作。
 */
async function sendLog(client, guildId, embed) {
  return sendLogs(client, guildId, [embed]);
}

/**
 * Presence intent 必須由部署者明確選擇啟用，避免未開啟 privileged
 * intent 時讓 Discord 以 4014 中斷整個 bot。
 */
function isPresenceLoggingAvailable() {
  const value = String(process.env.LOGGER_PRESENCE_ENABLED || '').trim().toLowerCase();
  return ['true', '1', 'yes', 'on'].includes(value);
}

/**
 * Guild Members intent 必須由部署者明確選擇啟用。
 */
function isMemberLoggingAvailable() {
  const value = String(process.env.LOGGER_MEMBERS_ENABLED || '').trim().toLowerCase();
  return ['true', '1', 'yes', 'on'].includes(value);
}

function getMemberUser(member) {
  return member?.user || null;
}

function getMemberId(member) {
  return getMemberUser(member)?.id || member?.id || null;
}

function formatMember(member) {
  const user = getMemberUser(member);
  const userId = getMemberId(member);
  if (!userId) return '未知使用者';
  const userLabel = user?.tag || user?.username || '資料未快取';
  return `<@${userId}> (${userLabel})`;
}

function formatKnownTime(value) {
  if (!value) return '未知';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '未知';
  return time(date, TimestampStyles.ShortDateTime);
}

function setUserThumbnail(embed, user) {
  if (typeof user?.displayAvatarURL !== 'function') return;
  try {
    const avatarUrl = user.displayAvatarURL();
    if (avatarUrl) embed.setThumbnail(avatarUrl);
  } catch {
    // Partial user 的頭像資料可能尚未快取；缺少縮圖不應中斷事件日誌。
  }
}

// ============== 事件特定 builders ==============

/**
 * 建立上線狀態變更 Embed
 */
function buildPresenceEmbed(oldPresence, newPresence) {
  if (!newPresence) return null;
  const member = newPresence.member || oldPresence?.member;
  const user = newPresence.user || member?.user || oldPresence?.user;
  if (!user?.id) return null;

  const oldStatus = oldPresence?.status || 'offline';
  const newStatus = newPresence.status || 'offline';
  if (oldStatus === newStatus) return null;

  // 中文化狀態名稱
  const statusMap = {
    online: '🟢 上線',
    idle: '🟡 閒置',
    dnd: '🔴 勿擾',
    offline: '⚫ 離線',
  };

  const colorKey = newStatus in COLORS ? newStatus : 'info';
  const userLabel = user.tag || user.username || user.id;
  const embed = new EmbedBuilder()
    .setColor(COLORS[colorKey])
    .setTitle('🔔 成員狀態變更')
    .addFields(
      { name: '👤 成員', value: `<@${user.id}> (${userLabel})`, inline: false },
      { name: '🔄 變更前', value: statusMap[oldStatus] || oldStatus, inline: true },
      { name: '➡️ 變更後', value: statusMap[newStatus] || newStatus, inline: true },
      { name: '🕐 時間', value: time(new Date(), TimestampStyles.ShortDateTime), inline: true },
    )
    .setFooter({ text: `User ID: ${user.id}` })
    .setTimestamp();

  if (typeof user.displayAvatarURL === 'function') {
    embed.setThumbnail(user.displayAvatarURL());
  }

  // 顯示當前活動（如有）
  const activity = newPresence.activities?.find(a => a.type !== undefined);
  if (activity && activity.name) {
    embed.addFields({ name: '🎮 當前活動', value: activity.name, inline: false });
  }

  return embed;
}

/**
 * 建立訊息刪除 Embed
 */
function buildMessageDeleteEmbed(message) {
  if (!message) return null;
  const author = message.author;
  const channel = message.channel;
  const channelId = message.channelId || channel?.id;
  const authorLabel = author?.id
    ? `<@${author.id}> (${author.tag || author.username || author.id})`
    : '未知使用者';
  const channelLabel = channelId
    ? `<#${channelId}> (${channel?.name || '未知'})`
    : '未知頻道';

  const embed = new EmbedBuilder()
    .setColor(COLORS.delete)
    .setTitle('🗑️ 訊息已刪除')
    .addFields(
      { name: '👤 作者', value: authorLabel, inline: false },
      { name: '📍 頻道', value: channelLabel, inline: false },
      { name: '🕐 刪除時間', value: time(new Date(), TimestampStyles.ShortDateTime), inline: true },
    )
    .setFooter({ text: `Message ID: ${message.id}` })
    .setTimestamp();

  if (author && typeof author.displayAvatarURL === 'function') {
    embed.setThumbnail(author.displayAvatarURL());
  }

  const content = message.partial || typeof message.content !== 'string'
    ? '(無法取得訊息內容：訊息未被快取)'
    : describeContent(message);
  embed.addFields({ name: '📝 訊息內容', value: truncate(content) || '(無內容)', inline: false });

  return embed;
}

/**
 * 建立訊息編輯 Embed（修改前 / 修改後並列）
 */
function buildMessageUpdateEmbed(oldMessage, newMessage) {
  if (!newMessage) return null;
  const author = newMessage.author || oldMessage?.author;
  const channel = newMessage.channel || oldMessage?.channel;
  const channelId = newMessage.channelId || oldMessage?.channelId || channel?.id;
  const guildId = newMessage.guildId || oldMessage?.guildId || channel?.guildId || channel?.guild?.id;
  const messageId = newMessage.id || oldMessage?.id;

  const oldContentUnavailable = !oldMessage
    || oldMessage.partial
    || typeof oldMessage.content !== 'string';
  const newContentUnavailable = newMessage.partial
    || typeof newMessage.content !== 'string';
  const oldContent = oldContentUnavailable
    ? '(無法取得修改前內容：訊息未被快取)'
    : describeContent(oldMessage);
  const newContent = newContentUnavailable
    ? '(無法取得修改後內容)'
    : describeContent(newMessage);

  // 比較文字、附件與貼圖；忽略 Discord 自動產生的 Embed/pin metadata 更新。
  const oldFingerprint = editableContentFingerprint(oldMessage);
  const newFingerprint = editableContentFingerprint(newMessage);
  if (oldFingerprint !== null && oldFingerprint === newFingerprint) return null;

  const authorLabel = author?.id
    ? `<@${author.id}> (${author.tag || author.username || author.id})`
    : '未知使用者';
  const channelLabel = channelId
    ? `<#${channelId}> (${channel?.name || '未知'})`
    : '未知頻道';

  const embed = new EmbedBuilder()
    .setColor(COLORS.update)
    .setTitle('✏️ 訊息已編輯')
    .addFields(
      { name: '👤 作者', value: authorLabel, inline: false },
      { name: '📍 頻道', value: channelLabel, inline: false },
      { name: '🕐 修改時間', value: time(new Date(), TimestampStyles.ShortDateTime), inline: true },
    )
    .setTimestamp();

  if (author && typeof author.displayAvatarURL === 'function') {
    embed.setThumbnail(author.displayAvatarURL());
  }
  if (guildId && channelId && messageId) {
    embed.addFields({
      name: '🔗 訊息連結',
      value: `[點此查看](https://discord.com/channels/${guildId}/${channelId}/${messageId})`,
      inline: true,
    });
  }
  if (messageId) embed.setFooter({ text: `Message ID: ${messageId}` });

  embed.addFields(
    { name: '🔴 修改前', value: truncate(oldContent) || '(無內容)', inline: false },
    { name: '🟢 修改後', value: truncate(newContent) || '(無內容)', inline: false },
  );

  return embed;
}

/**
 * 建立成員加入伺服器 Embed。即使 GuildMember 為 partial，也會以可取得的
 * ID 建立日誌，無法取得的欄位則明確顯示為未知。
 */
function buildMemberJoinEmbed(member) {
  const userId = getMemberId(member);
  if (!userId) return null;
  const user = getMemberUser(member);
  const accountCreatedAt = user?.createdAt || user?.createdTimestamp;

  const embed = new EmbedBuilder()
    .setColor(COLORS.memberJoin)
    .setTitle('📥 成員加入伺服器')
    .addFields(
      { name: '👤 成員', value: formatMember(member), inline: false },
      { name: '📅 帳號建立', value: formatKnownTime(accountCreatedAt), inline: true },
      { name: '🕐 加入時間', value: formatKnownTime(member?.joinedAt), inline: true },
    )
    .setFooter({ text: `User ID: ${userId}` })
    .setTimestamp();

  setUserThumbnail(embed, user);
  return embed;
}

/**
 * 建立成員離開或遭移除伺服器 Embed。
 */
function buildMemberRemoveEmbed(member) {
  const userId = getMemberId(member);
  if (!userId) return null;
  const user = getMemberUser(member);

  const embed = new EmbedBuilder()
    .setColor(COLORS.memberLeave)
    .setTitle('📤 成員離開／遭移除')
    .addFields(
      { name: '👤 成員', value: formatMember(member), inline: false },
      { name: '📅 原加入時間', value: formatKnownTime(member?.joinedAt), inline: true },
      { name: '🕐 離開／移除時間', value: time(new Date(), TimestampStyles.ShortDateTime), inline: true },
    )
    .setFooter({ text: `User ID: ${userId}` })
    .setTimestamp();

  setUserThumbnail(embed, user);
  return embed;
}

/**
 * 建立語音頻道加入、離開或移動 Embed。靜音等同頻道內狀態變化不屬於
 * movement，因此 old/new channel 相同時回傳 null。
 */
function buildVoiceStateEmbed(oldState, newState) {
  const oldChannel = oldState?.channel || null;
  const newChannel = newState?.channel || null;
  const oldChannelId = oldState?.channelId || oldChannel?.id || null;
  const newChannelId = newState?.channelId || newChannel?.id || null;
  if (oldChannelId === newChannelId) return null;

  const member = newState?.member || oldState?.member || null;
  const userId = getMemberId(member) || newState?.id || oldState?.id || null;
  const user = getMemberUser(member);
  const memberLabel = userId
    ? `<@${userId}> (${user?.tag || user?.username || '資料未快取'})`
    : '未知使用者';
  const oldChannelLabel = oldChannelId
    ? `<#${oldChannelId}> (${oldChannel?.name || '未知'})`
    : '*(未連線)*';
  const newChannelLabel = newChannelId
    ? `<#${newChannelId}> (${newChannel?.name || '未知'})`
    : '*(未連線)*';

  let title = '🔀 成員移動語音頻道';
  let color = COLORS.voice;
  if (!oldChannelId) {
    title = '🔊 成員加入語音頻道';
    color = COLORS.memberJoin;
  } else if (!newChannelId) {
    title = '🔇 成員離開語音頻道';
    color = COLORS.memberLeave;
  }

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .addFields(
      { name: '👤 成員', value: memberLabel, inline: false },
      { name: '🔈 原頻道', value: oldChannelLabel, inline: true },
      { name: '🔊 新頻道', value: newChannelLabel, inline: true },
      { name: '🕐 時間', value: time(new Date(), TimestampStyles.ShortDateTime), inline: true },
    )
    .setTimestamp();

  if (userId) embed.setFooter({ text: `User ID: ${userId}` });
  setUserThumbnail(embed, user);
  return embed;
}

module.exports = {
  COLORS,
  getSettings,
  updateSetting,
  truncate,
  describeContent,
  getExcludedChannels,
  isExcludedChannel,
  shouldIgnore,
  sendLogs,
  sendLog,
  isPresenceLoggingAvailable,
  isMemberLoggingAvailable,
  buildPresenceEmbed,
  buildMessageDeleteEmbed,
  buildMessageUpdateEmbed,
  buildMemberJoinEmbed,
  buildMemberRemoveEmbed,
  buildVoiceStateEmbed,
};
