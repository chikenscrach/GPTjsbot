# GPTjsbot 文件中心 📚

這裡集中放置 GPTjsbot 的完整使用、部署與維護文件。README 只保留專案介紹與快速開始；需要進階設定時再進入對應章節即可。

## 從這裡開始

| 你的目標 | 建議閱讀 |
| --- | --- |
| 第一次部署 Bot | [Installation](installation.md) → [Deployment](deployment.md) |
| 想知道 `.env` 要填什麼 | [Configuration](configuration.md) |
| 查指令怎麼用 | [Commands](commands.md) |
| 修改 Instagram / TikTok 等轉換網址 | [URL Converter](url-converter.md) |
| 設定伺服器事件日誌 | [Logger](logger.md) |
| 更新後資料不見、4014、指令沒出現 | [Troubleshooting](troubleshooting.md) |
| 新增 Slash Command 或 URL Handler | [Development](development.md) |

## 文件地圖

### 使用者

- **[Installation](installation.md)**：Discord Application、Bot Token、Intents 與必要帳號資訊。
- **[Configuration](configuration.md)**：`.env`、Groq、摘要服務、SQLite 資料目錄與 `settings.json`。
- **[Commands](commands.md)**：常用 Slash Commands 與管理指令。
- **[URL Converter](url-converter.md)**：網址轉換平台、`/url`、自訂簡單規則。
- **[Logger](logger.md)**：事件類型、權限、Intents、排除規則與隱私設計。

### 部署與維護

- **[Deployment](deployment.md)**：Docker Compose、Docker Run、Node.js、GHCR、更新與持久化。
- **[Troubleshooting](troubleshooting.md)**：常見錯誤與資料復原。

### 開發者

- **[Development](development.md)**：專案結構、新增指令、新增網址 Handler。

---

> 文件內容以 `main` 分支的程式與範例設定為準。若你從較舊版本升級，先閱讀 Deployment 與 Troubleshooting，再重建容器。
