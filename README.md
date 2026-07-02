# GPTjsbot 🤖

<p align="center">
  <img src="https://img.shields.io/badge/Container-GHCR-blue?style=flat-square&logo=github" alt="GHCR">
  <img src="https://img.shields.io/badge/Node.js->=20.0.0-green?style=flat-square&logo=node.js" alt="Node.js Version">
  <img src="https://img.shields.io/badge/Discord.js-v14-blue?style=flat-square&logo=discord" alt="Discord.js Version">
  <img src="https://img.shields.io/badge/Docker-Supported-blue?style=flat-square&logo=docker" alt="Docker">
  <img src="https://img.shields.io/github/license/chikenscrach/GPTjsbot?style=flat-square" alt="License">
</p>

<p align="center">
  <strong>基於 Discord.js v14 + Node.js 的全能型個人 Discord 機器人。</strong><br>
  整合 <b>Groq AI 聊天（支援自訂模型）</b>、<b>多平台網址自動修復 (Embed Fixer)</b>、<b>SQLite 提醒系統</b>，並支援 <b>Docker 容器化部署</b>。
</p>

---

## 🌟 核心特色

*   🤖 **AI 智慧聊天**：整合 **Groq API**，支援極速的 Llama / Mixtral 等模型對話，內建 SQLite 記憶對話上下文，自動翻譯繁體中文，且**完美支援長訊息自動分段發送**，徹底防範 Discord 2000 字元長度限制。
*   ⚙️ **可自訂對話模型**：模型不再寫死！開發者可在 `.env` 檔案中設定全域預設模型，使用者也可以直接在 `/chat` 指令的選單中即時切換不同的官方模型（如極速的 Llama 8B、強大的 Llama 3.3 70B、GPT OSS 或是 Qwen3 等官方支援模型）。
*   🔗 **自動網址轉換 (Embed Fixer)**：當使用者發送特定平台（如 X/Twitter, Instagram, Facebook）網址時，機器人會自動修正為可直接預覽影片/多圖的替代服務網址（例如 `fixvx.com`, `kkinstagram.com` 等）。
*   ⏰ **輕量化提醒系統**：透過內建的 SQLite 與排程器，隨時設定個人/頻道的定時提醒事項。
*   🐋 **生產級 Docker 支援**：基於 `node:20-slim` 進行多階段建置 (Multi-stage build)，內建 `tini` 防範殭屍進程，並以非 root 權限 (`appuser`) 安全運行。已自動發佈至 **GitHub Container Registry (GHCR)**。
*   🧩 **模組化架構**：易於擴充，只需在 `commands/` 或 `handlers/` 目錄新增檔案，即可無痛增加新指令與新網址解析規則。

---

## 🛠️ 前置準備

### 1. 取得 API 金鑰與 Token
*   **Discord Bot Token**：請至 [Discord Developer Portal](https://discord.com/developers/applications) 建立 Application 並取得 Token。
*   **Groq API Key**：請至 [Groq Console](https://console.groq.com/) 免費申請。

### 2. 開啟 Discord Intents ⚠️（重要）
為了讓機器人能正常接收指令並偵測網址，請務必在 Discord Developer Portal 的 **"Bot"** 分頁中啟用以下權限：
- [x] **Presence Intent**
- [x] **Server Members Intent**
- [x] **Message Content Intent** (若未開啟，網址自動轉換功能將無法讀取訊息內容)

---

## ⚙️ 環境變數設定 (`.env`)

請在專案根目錄建立 `.env` 檔案（可參考 `.env.sample`）：

| 變數名稱 | 是否必填 | 說明 | 預設值 / 範例 |
| :--- | :---: | :--- | :--- |
| `DISCORD_TOKEN` | **是** | 你的 Discord Bot Token | `MTIzNDU2...` |
| `CLIENT_ID` | **是** | 你的 Discord Application Client ID | `123456789012345678` |
| `BOT_OWNER_ID` | **是** | 機器人擁有者的 Discord User ID | `876543210987654321` |
| `GROQ_API_KEY` | **是** | Groq API Key | `gsk_abc123...` |
| `GROQ_MODEL` | 否 | AI 聊天預設模型 | `llama-3.3-70b-versatile` |
| `GROQ_SYSTEM_PROMPT` | 否 | 自訂 AI 的角色設定 (System Prompt) | `你是一位專業且親切的 Discord 智慧助手...` |
| `BOT_STATUS` | 否 | 機器人狀態 (`online`, `idle`, `dnd`) | `online` |
| `BOT_ACTIVITY_TYPE` | 否 | 活動類型 (`Playing`, `Watching`, `Listening`) | `Playing` |
| `BOT_ACTIVITY_NAME` | 否 | 狀態欄顯示文字 | `GPTjsbot | /help` |

---

## 🚀 部署與執行

您可以選擇使用 Docker 直接拉取官方封裝好的 GHCR 映像檔（最推薦、最快速），或是使用傳統 Node.js 本地部署。

### 方案 A：使用 Docker 部署（推薦 🐳）

本專案已發佈至 **GitHub Container Registry (GHCR)**。您無需自行建置（Build）映像檔，可直接拉取 (Pull) 官方映像檔快速啟動。

#### 1. 拉取 GHCR 映像檔
```bash
docker pull ghcr.io/chikenscrach/gptjsbot:latest
```

#### 2. 啟動容器
您可以選擇使用 **Docker Compose**（極力推薦，方便管理）或傳統的 **Docker Run**。

##### 💡 方式一：使用 Docker Compose（極佳維護性）
在根目錄下建立 `docker-compose.yml` 檔案：
```yaml
services:
  gptjsbot:
    image: ghcr.io/chikenscrach/gptjsbot:latest
    container_name: gptjsbot
    restart: unless-stopped
    env_file:
      - .env
    volumes:
      - ./data:/app/data
```
啟動服務：
```bash
docker-compose up -d
```

##### 💡 方式二：使用 Docker Run 傳統啟動
```bash
docker run -d \
  --name gptjsbot \
  --env-file .env \
  -v ./data:/app/data \
  ghcr.io/chikenscrach/gptjsbot:latest
```

> ⚠️ **注意事項：** 
> * 請務必掛載 `-v ./data:/app/data`，這樣內建的 SQLite 資料庫 (`bot.db`) 在容器升級或重啟時，數據（如對話上下文、提醒設定）才不會遺失。
> * 請確認宿主機的 `./data` 資料夾具備正確的讀寫權限。

---

### 方案 B：傳統 Node.js 本地部署

1. **安裝依賴套件**
   ```bash
   npm install
   ```

2. **註冊 Slash (斜線) 指令**
   每當新增、修改指令或首次啟動時，請先執行此步驟：
   ```bash
   node core/deploy-commands.js
   ```

3. **啟動機器人**
   ```bash
   node index.js
   ```

---

## 📁 專案結構說明

```text
GPTjsbot/
├── commands/               # Slash 指令模組 (自動讀取)
│   ├── chat.js             # AI 聊天 (/chat，支援自訂模型選單)
│   ├── reminder.js         # 設定提醒 (/reminder)
│   └── ...                 # ping, avatar, info, status, help
├── core/                   # 核心調度邏輯
│   ├── chat.js             # Groq API 封裝與可配置模型邏輯
│   ├── db.js               # SQLite 資料庫初始化
│   ├── deploy-commands.js  # Discord 斜線指令部署腳本
│   └── scheduler.js        # 定時提醒任務排程器
├── events/
│   └── messageCreate.js    # 監聽訊息（負責網址偵測與轉換）
├── handlers/               # 網址解析與格式修復模組 (Modular Handlers)
│   ├── facebook.js         # 處理 Facebook 貼文、多圖與小幫手
│   ├── twitter.js          # 轉換 Twitter / X 連結至 Fixvx
│   ├── threads.js          # 清理 Threads 網址與追蹤參數
│   ├── simple.js           # Pixiv, IG, Bilibili 等簡單取代規則
│   ├── youtube.js          # YouTube 轉簡短網址
│   └── index.js            # 集中匯出網址處理器
├── data/
│   └── bot.db              # SQLite 本地資料庫 (自動產生)
├── Dockerfile              # 多階段、高安全性的 Docker 映像檔建置規則
├── LICENSE                 # 開源授權條款 (MIT)
└── index.js                # 專案程式入口點
```

---

## 📖 功能清單

### 🤖 斜線指令 (Slash Commands)
*   `/chat [message] [model]`：與 AI 助手對話。
    *   `message`：對話內容。
    *   `model`（選填）：直接在選單中覆寫預設設定，即時選用不同模型（如 Llama 3.3 70B、Llama 3.1 8B、GPT OSS 120B、Qwen 3.6 27B 等）。
*   `/reminder [time] [message] [channel]`：設定定時提醒，時間格式支援 `10m`、`2h`、`1d` 等。
*   `/status`：診斷並顯示當前系統狀態（包含記憶體佔用、運行時間與延遲）。
*   `/ping`：測試機器人與 Discord API 的延遲。
*   `/avatar [user]`：取得指定使用者的頭像。
*   `/info`：取得伺服器或使用者詳細資訊。
*   `/help`：列出所有可用指令。

### 🔗 自動網址轉換對照表 (Embed Fixer)
當一般使用者發送以下平台網址時，機器人會**自動刪除原先失效或難看的預覽**，並改寫為能完美呈現影音預覽的替代連結：

| 原始網址 | 轉換後網址 (修復預覽) | 備註說明 |
| :--- | :--- | :--- |
| `x.com` / `twitter.com` | `fixvx.com` | 完美還原 X 影片與多圖預覽 |
| `pixiv.net` | `phixiv.net` | 解決 Pixiv 圖片無法直接在 Discord 顯示的問題 |
| `tiktok.com` | `tnktok.com` | 支援 TikTok 影片在 Discord 內直接播放 |
| `instagram.com` | `kkinstagram.com` | 修正 IG 貼文、Reels 影片無法預覽的問題 |
| `bsky.app` | `fxbsky.app` | 修正 Bluesky 預覽 |
| `bilibili.com` / `b23.tv` | `vxbilibili.com` / `vxb23.tv` | 修正 B 站影片預覽 |
| `threads.net` | `threads.com` | 移除 `www.` 與惱人的 `?xpt=` 追蹤參數 |
| `facebook.com` / `fb.watch` | `facebed.com` | 自動解析真實貼文 ID，排除登入牆限制 |
| `youtube.com` | `youtu.be` | 自動標準化為 YouTube 短網址 |

---

## 🛠️ 開發與擴充指南

本專案架構完全模組化，您可以極其輕鬆地擴充它：

### 如何新增一個 Slash 指令？
1. 在 `commands/` 資料夾下建立一個新的 `.js` 檔案（例如 `hello.js`）。
2. 匯出符合 Discord.js 規範的指令結構：
   ```javascript
   const { SlashCommandBuilder } = require('discord.js');
   module.exports = {
     data: new SlashCommandBuilder()
       .setName('hello')
       .setDescription('向你打招呼'),
     async execute(interaction) {
       await interaction.reply('哈囉！');
     },
   };
   ```
3. 重新執行 `node core/deploy-commands.js` 註冊指令，並重啟 Bot。

### 如何新增網址轉換規則？
*   如果是**簡單的域名替換**：直接編輯 `handlers/simple.js` 裡的 `domainMap`。
*   如果是**複雜的 API 解析**：在 `handlers/` 下建立新的處理器檔案，並在 `handlers/index.js` 中註冊即可。

---

## 📄 授權條款

本專案採用 [MIT License](LICENSE) 進行授權。歡迎自由 Fork、修改與分享！
