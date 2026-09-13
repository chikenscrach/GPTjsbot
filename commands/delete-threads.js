const {
  ApplicationCommandType,
  ButtonStyle,
  ComponentType,
  ContextMenuCommandBuilder,
  InteractionContextType,
  MessageFlags,
  MessageReferenceType,
  MessageType,
  PermissionFlagsBits,
} = require('discord.js');
const threadsMessages = require('../core/threads-messages');

function isThreadsPostUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && /^(?:www\.)?threads\.(?:com|net)$/.test(url.hostname)
      && !url.username && !url.password && !url.port
      && /^\/@[\w.]+\/post\/[\w-]+\/?$/.test(url.pathname);
  } catch {
    return false;
  }
}

function hasThreadsMarker(message) {
  const hasEmbed = message.embeds?.some(embed => {
    const data = typeof embed.toJSON === 'function' ? embed.toJSON() : embed;
    return /^Threads(?: • |$)/.test(data.footer?.text || '') && isThreadsPostUrl(data.url);
  });
  const hasButton = message.components?.some(row => {
    const data = typeof row.toJSON === 'function' ? row.toJSON() : row;
    return data.components?.some(button => button.type === ComponentType.Button
      && button.style === ButtonStyle.Link
      && button.label === '開啟原文'
      && isThreadsPostUrl(button.url));
  });
  return Boolean(hasEmbed || hasButton);
}

function isLegacyThreadsReply(message, guildId, channelId) {
  const reference = message.reference;
  return message.type === MessageType.Reply
    && reference?.messageId
    && reference.channelId === channelId
    && (!reference.guildId || reference.guildId === guildId)
    && (reference.type == null || reference.type === MessageReferenceType.Default)
    && hasThreadsMarker(message);
}

module.exports = {
  data: new ContextMenuCommandBuilder()
    .setName('刪除 Threads 訊息')
    .setType(ApplicationCommandType.Message)
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const reply = content => interaction.editReply({ content });
    const { guildId, channelId, targetMessage: target } = interaction;

    if (!guildId) return reply('❗ 這個指令只能在伺服器中使用。');
    if (!target || !interaction.client.user?.id
      || target.author?.id !== interaction.client.user.id
      || target.webhookId || target.interactionMetadata || target.interaction
      || target.guildId !== guildId || target.channelId !== channelId
      || target.id !== interaction.targetId) {
      return reply('❌ 請對本機器人傳送的 Threads 訊息使用這個指令。');
    }

    let record;
    try {
      record = threadsMessages.getThreadsMessage(target.id, guildId, channelId);
    } catch (err) {
      console.warn('[Threads] 無法讀取訊息擁有者：', err?.message || err);
      return reply('❌ 暫時無法確認這則訊息的擁有者，請稍後再試。');
    }

    // memberPermissions 是 Discord 提供的目前頻道權限，has 亦涵蓋管理員。
    const isModerator = Boolean(interaction.memberPermissions?.has?.(PermissionFlagsBits.ManageMessages));
    let authorId = record?.author_id;
    if (!record) {
      if (!isLegacyThreadsReply(target, guildId, channelId)) {
        return reply('❌ 找不到這則訊息的 Threads 紀錄；可能已刪除，或是無法辨識的舊版額外媒體訊息。');
      }

      // 舊版主訊息沒有資料庫紀錄，僅以實際回覆的 Discord 訊息認定本人。
      if (!isModerator) {
        let source;
        try {
          source = await interaction.channel.messages.fetch({
            message: target.reference.messageId,
            force: true,
          });
        } catch (err) {
          if (Number(err?.code) !== 10008) {
            console.warn('[Threads] 無法取得原始訊息：', err?.message || err);
          }
          return reply('❌ 無法確認原始發文者（原訊息可能已刪除），請由有「管理訊息」權限的成員刪除。');
        }
        if (source?.id !== target.reference.messageId
          || source.guildId !== guildId || source.channelId !== channelId
          || !source.author?.id) {
          return reply('❌ 無法確認原始發文者，請由有「管理訊息」權限的成員刪除。');
        }
        authorId = source.author.id;
      }
    }

    if (!isModerator && authorId !== interaction.user.id) {
      return reply('❌ 只有原始發文者或有「管理訊息」權限的成員可以刪除這則 Threads 訊息。');
    }

    let alreadyDeleted = false;
    try {
      // 僅刪除右鍵選取的機器人訊息，原始使用者訊息不受影響。
      await target.delete();
    } catch (err) {
      if (Number(err?.code) === 10008) {
        alreadyDeleted = true;
      } else {
        console.warn('[Threads] 無法刪除訊息：', err?.message || err);
        return reply('❌ 無法刪除這則訊息，請確認機器人仍可存取該頻道後再試。');
      }
    }

    try {
      threadsMessages.forgetThreadsMessage(target.id);
    } catch (err) {
      console.warn('[Threads] 無法清除已刪除訊息的紀錄：', err?.message || err);
    }
    return reply(alreadyDeleted ? '✅ 這則 Threads 訊息已經不存在。' : '✅ 已刪除這則 Threads 訊息。');
  },
};
