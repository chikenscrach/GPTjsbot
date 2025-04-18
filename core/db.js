const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(path.join(__dirname, '../data/bot.db'));

// 初始化資料表
db.exec(`
  CREATE TABLE IF NOT EXISTS reminders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    remind_at INTEGER NOT NULL,
    message TEXT,
    method TEXT NOT NULL,
    channel_id TEXT
  );
`);

module.exports = db;
