const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

// 確認資料夾存在
const dataPath = process.env.BOT_DATA_DIR
  ? path.resolve(process.env.BOT_DATA_DIR)
  : path.join(__dirname, '../data');
if (!fs.existsSync(dataPath)) {
  fs.mkdirSync(dataPath, { recursive: true });
}

// 連接 SQLite 資料庫
const db = new Database(path.join(dataPath, 'bot.db'));

// WAL 模式可大幅改善並發讀寫效能
db.pragma('journal_mode = WAL');

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
  CREATE INDEX IF NOT EXISTS idx_reminders_remind_at ON reminders (remind_at);

  CREATE TABLE IF NOT EXISTS logger_settings (
    guild_id TEXT PRIMARY KEY,
    channel_id TEXT,
    enabled INTEGER NOT NULL DEFAULT 0,
    log_presence INTEGER NOT NULL DEFAULT 1,
    log_message_delete INTEGER NOT NULL DEFAULT 1,
    log_message_update INTEGER NOT NULL DEFAULT 1,
    log_member_join INTEGER NOT NULL DEFAULT 0,
    log_member_leave INTEGER NOT NULL DEFAULT 0,
    log_voice INTEGER NOT NULL DEFAULT 0,
    exclude_channels TEXT NOT NULL DEFAULT '',
    exclude_bots INTEGER NOT NULL DEFAULT 1,
    updated_at INTEGER NOT NULL DEFAULT 0
  );
`);

// logger_settings 曾在沒有下列欄位的版本中建立。SQLite 的
// CREATE TABLE IF NOT EXISTS 不會更新既有資料表，因此啟動時以實際 schema
// 為準逐欄 migration。欄位定義固定於程式碼中，且交易可安全重複執行。
const loggerSettingsMigrations = [
  ['log_member_join', 'INTEGER NOT NULL DEFAULT 0'],
  ['log_member_leave', 'INTEGER NOT NULL DEFAULT 0'],
  ['log_voice', 'INTEGER NOT NULL DEFAULT 0'],
];

db.transaction(() => {
  const existingColumns = new Set(
    db.pragma('table_info(logger_settings)').map(column => column.name),
  );
  for (const [columnName, definition] of loggerSettingsMigrations) {
    if (existingColumns.has(columnName)) continue;
    db.exec(`ALTER TABLE logger_settings ADD COLUMN ${columnName} ${definition}`);
    existingColumns.add(columnName);
  }
})();

module.exports = db;
