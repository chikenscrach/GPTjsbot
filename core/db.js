const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

// 確認資料夾存在
const dataPath = path.join(__dirname, '../data');
if (!fs.existsSync(dataPath)) {
  fs.mkdirSync(dataPath, { recursive: true });
}

// 連接 SQLite 資料庫
const db = new Database(path.join(dataPath, 'bot.db'));

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
