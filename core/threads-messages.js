const db = require('./db');

const insert = db.prepare(`
  INSERT INTO threads_messages (message_id, guild_id, channel_id, source_message_id, author_id)
  VALUES (?, ?, ?, ?, ?)
`);
const find = db.prepare(`
  SELECT * FROM threads_messages WHERE message_id = ? AND guild_id = ? AND channel_id = ?
`);
const remove = db.prepare('DELETE FROM threads_messages WHERE message_id = ?');

function recordThreadsMessage(sentMessage, sourceMessage) {
  if (!sourceMessage.guildId) return; // 刪除指令僅供伺服器使用。
  insert.run(sentMessage.id, sourceMessage.guildId, sourceMessage.channelId,
    sourceMessage.id, sourceMessage.author.id);
}

function getThreadsMessage(messageId, guildId, channelId) {
  return find.get(messageId, guildId, channelId);
}

function forgetThreadsMessage(messageId) {
  remove.run(messageId);
}

module.exports = { recordThreadsMessage, getThreadsMessage, forgetThreadsMessage };
