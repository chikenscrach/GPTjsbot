const db = require('./db');

// 沿用原 threads_messages 資料表，保留升級前的 Threads 擁有者紀錄。
// 現在所有網址轉換產生的訊息都共用這份紀錄。
const insert = db.prepare(`
  INSERT INTO threads_messages (message_id, guild_id, channel_id, source_message_id, author_id)
  VALUES (?, ?, ?, ?, ?)
`);
const find = db.prepare(`
  SELECT * FROM threads_messages WHERE message_id = ? AND guild_id = ? AND channel_id = ?
`);
const remove = db.prepare('DELETE FROM threads_messages WHERE message_id = ?');

function recordConvertedMessage(sentMessage, sourceMessage) {
  if (!sourceMessage.guildId) return; // 刪除指令僅供伺服器使用。
  insert.run(sentMessage.id, sourceMessage.guildId, sourceMessage.channelId,
    sourceMessage.id, sourceMessage.author.id);
}

function getConvertedMessage(messageId, guildId, channelId) {
  return find.get(messageId, guildId, channelId);
}

function forgetConvertedMessage(messageId) {
  remove.run(messageId);
}

module.exports = { recordConvertedMessage, getConvertedMessage, forgetConvertedMessage };
