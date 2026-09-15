<div align="center">

# GPTjsbot 🤖

**以 Discord.js v14 + Node.js 打造的多功能 Discord 機器人**

AI 對話、網頁摘要、網址預覽修復、Discord Quest 查詢、提醒與伺服器事件日誌，一個 Bot 整合完成。

[![Container](https://img.shields.io/badge/Container-GHCR-blue?style=flat-square&logo=github)](https://github.com/chikenscrach/GPTjsbot/pkgs/container/gptjsbot)
![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22-green?style=flat-square&logo=node.js)
![Discord.js](https://img.shields.io/badge/Discord.js-v14-5865F2?style=flat-square&logo=discord)
![Docker](https://img.shields.io/badge/Docker-Supported-2496ED?style=flat-square&logo=docker)
[![License](https://img.shields.io/github/license/chikenscrach/GPTjsbot?style=flat-square)](LICENSE)

[快速開始](#-快速開始) · [功能](#-功能一覽) · [完整文件](docs/) · [設定說明](docs/configuration.md) · [疑難排解](docs/troubleshooting.md)

</div>

---

## ✨ 功能一覽

| 功能 | 說明 |
| --- | --- |
| 🤖 **AI Chat** | 使用 Groq API 對話，可自訂預設模型與 System Prompt，並處理 Discord 長訊息限制。 |
| 📝 **網頁摘要** | `/summarize` 擷取網頁內容並交由外部摘要服務整理重點，可選擇私人回覆。 |
| 🔗 **Embed Fixer** | 自動改善 X / Instagram / TikTok / Pixiv / Bluesky / Bilibili / Threads / Facebook / YouTube 等連結在 Discord 的預覽體驗。 |
| ⚙️ **可設定網址規則** | 簡單的網域替換可直接在 `settings.json` 新增或修改，不必改程式；每個伺服器可用 `/url` 個別開關。 |
| 🎯 **Discord Quest** | 查詢、搜尋與篩選 Discord Quest，支援獎勵、地區、年齡、連動任務等條件。 |
| ⏰ **Reminder** | 使用 SQLite 儲存定時提醒。 |
| 📋 **Logger** | 可選擇記錄成員、Presence、語音與訊息異動，並支援排除頻道與事件類型。 |
| 🐳 **Docker / GHCR** | 提供預先建置映像與 Compose 範例，資料可透過 volume 持久化。 |

> 第一次使用？建議從 **[完整安裝指南](docs/installation.md)** 開始。README 只保留最常用流程，進階設定集中在 `docs/`。

---

## 🚀 快速開始

### 1. 準備必要資訊

你至少需要：

- Discord Bot Token
- Discord Application Client ID
- Discord User ID（作為 `BOT_OWNER_ID`）
- Groq API Key

詳細的 Discord Application、Intents 與邀請設定請看 **[安裝指南](docs/installation.md)**。

### 2. 下載專案並建立設定

```bash
git clone https://github.com/chikenscrach/GPTjsbot.git
cd GPTjsbot
cp .env.sample .env
```

編輯 `.env`，至少填入：

```env
DISCORD_TOKEN=你的 Discord Bot Token
CLIENT_ID=你的 Discord App Client ID
BOT_OWNER_ID=你的 Discord 使用者 ID
GROQ_API_KEY=你的 Groq API Key
```

完整變數說明：**[Configuration](docs/configuration.md)**

### 3. 使用 Docker Compose 啟動（推薦）

```bash
docker compose -f compose.example.yaml up -d
```

首次部署，或新增／修改 Discord 應用程式指令後，註冊指令：

```bash
docker exec gptjsbot npm run deploy
```

完成後可在 Discord 使用 `/help` 確認指令是否載入。

> `./data` 會掛載到容器的 `/app/data`。請保留這個資料目錄，避免 Logger 設定、提醒與其他 SQLite 資料在重建容器後遺失。

### 不使用 Docker？

```bash
npm install
npm run deploy
npm start
```

需要更新映像、調整 volume 或從舊容器復原資料時，請依照 **[部署指南](docs/deployment.md)** 操作，不要直接刪除舊資料卷。

---

## 🧭 文件導覽

完整文件已從 README 拆出，讓專案首頁保持簡潔：

| 想做什麼？ | 文件 |
| --- | --- |
| 第一次安裝與設定 Discord Bot | **[Installation](docs/installation.md)** |
| 查 `.env`、模型、摘要服務與資料目錄設定 | **[Configuration](docs/configuration.md)** |
| Docker、GHCR、Node.js、更新與持久化 | **[Deployment](docs/deployment.md)** |
| 查所有 Slash Commands | **[Commands](docs/commands.md)** |
| 自訂網址轉換與 `/url` | **[URL Converter](docs/url-converter.md)** |
| 設定 `/logger` | **[Logger](docs/logger.md)** |
| 4014、指令沒出現、資料消失等問題 | **[Troubleshooting](docs/troubleshooting.md)** |
| 新增指令或 Handler | **[Development](docs/development.md)** |

也可以直接進入 **[📚 文件首頁](docs/)**。

---

## 🗂️ 專案概覽

```text
GPTjsbot/
├── commands/        # Slash Command 與右鍵指令
├── core/            # 資料庫、排程、Discord 互動與核心服務
├── events/          # Discord Event handlers
├── handlers/        # 網址解析與轉換 handlers
├── utils/           # 共用工具
├── docs/            # 完整使用與維護文件
├── data/            # SQLite 資料（執行後產生／使用）
├── settings.example.json
├── compose.example.yaml
├── Dockerfile
└── index.js
```

想參與開發或加入新功能，請看 **[開發指南](docs/development.md)**。

---

## 📄 License

本專案採用 [MIT License](LICENSE)。

<div align="center">

Made with Discord.js · Node.js · SQLite · Groq

</div>
