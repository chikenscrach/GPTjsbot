# GPTjsbot 🤖

這是一個使用 Discord.js + Node.js 製作的個人用 Discord Bot。支援 Slash 指令、網址轉換、自訂提醒、聊天與模組化指令管理，軟量易擴充，適合個人使用。

---

## 🧪 前置需求

請先安裝以下軟體：

- [Node.js](https://nodejs.org/) v18 或更新版
- [npm](https://www.npmjs.com/) (隨 Node.js 一起安裝)
- 已創建的 Discord Bot 應用程式 (Application)，帶 Slash Commands 權限

---

## 📦 安裝依賴

```bash
npm install
```

---

## ⚙️ 環境設定

請建立 `.env` 檔案，並依照下方格式填入：

```env
DISCORD_TOKEN=你的 Discord Bot Token
CLIENT_ID=你的 Discord App Client ID
BOT_OWNER_ID=你的 Discord 使用者 ID

BOT_STATUS=online
BOT_ACTIVITY_TYPE=Playing
BOT_ACTIVITY_NAME=GPTjsbot | /help

GROQ_API_KEY=你的 Groq API Key
```

可參考 `.env.sample` 範本檔案。

---

## 🚀 註冊 Slash 指令

```bash
node core/deploy-commands.js
```

會自動讀取 `commands/` 資料夾內的 `.js` 檔案。

---

## 🧪 啟動機器人

```bash
node index.js
```

或使用 Docker：

```bash
docker run -d \
  --name gptjsbot \
  --env-file .env \
  ghcr.io/chikenscrach/gptjsbot:latest
```

請確保載入正確的 `.env` 環境設定。

---

## 📁 專案結構

```
GPTjsbot/
├── commands/               # Slash 指令模組
│   ├── avatar.js
│   ├── chat.js
│   ├── help.js
│   ├── info.js
│   ├── ping.js
│   ├── reminder.js
│   └── status.js
│
├── core/                   # 核心功能模組
│   ├── chat.js
│   ├── db.js
│   ├── deploy-commands.js
│   └── scheduler.js
│
├── events/
│   └── messageCreate.js    # 訊息網址自動轉換
│
├── utils/
│   └── youtube.js          # 解析 YouTube 網址為 short link
│
├── data/
│   └── bot.db              # SQLite 資料庫
│
├── Dockerfile              # Docker 建立檔
├── .env                    # 環境設定（請勿上傳）
├── .env.sample             # 環境設定參考範例
├── .gitignore
├── index.js                # Bot 主程式入口
├── node_modules/
├── package.json
└── README.md
```

---

## ✨ 功能一覽

### 🤖 機器人指令
- `/ping` 測試延遲
- `/avatar` 顯示使用者頭像
- `/info` 查詢使用者或伺服器資訊
- `/status` 機器人上線狀況（診斷記憶體、運行時間等）
- `/reminder` 設定提醒，可選頻道或私訊
- `/chat` 與 AI 對話 [→ 請看 AI 對話區段](#-聊天-ai-對話chat)
- `/help` 顯示目前可用指令

---

### 💬 聊天 AI 對話（/chat）

使用 Groq API 後端連線，不必登入。預設模型為 `groq/compound`。

---

### 🔗 自動網址轉換

偵測訊息中特定網址，自動關閉原 embed，轉成替代網址：

| 原始網址              | 轉換網址           |
|----------------------|--------------------|
| `x.com` / `twitter.com` | `fixvx.com`       |
| `pixiv.net`          | `phixiv.net`       |
| `tiktok.com`         | `tnktok.com`       |
| `instagram.com`      | `kkinstagram.com`  |
| `bsky.app`           | `fxbsky.app`       |
| `bilibili.com`       | `vxbilibili.com`   |
| `b23.tv`             | `vxb23.tv`         |
| `youtube.com` / `youtu.be` | `https://youtu.be/{id}` (已是 short link 則跳過) |

✅ 僅處理人類使用者發送的訊息，無視其他機器人發送。

---

## ⚠️ 注意事項

- 使用 Discord.js v14 或更新版。
- `.env` 請勿上傳，仅保留 `.env.sample`。
- 如出現下列警告，表示已經棄用寫法：

  ```
  Warning: Supplying "fetchReply" ... is deprecated
  Warning: Supplying "ephemeral" ... is deprecated
  ```
  → 請改用 `interaction.fetchReply()` 與 `flags: InteractionResponseFlags.Ephemeral`

---

## 💾 資料儲存

- 使用 SQLite 儲存提醒事項與 ChatGPT 對話記錄
- 資料庫位於 `data/bot.db`，可自由備份或重新建立

---

🔧 本專案為個人使用，不包含 AI 訓練或大型資料庫，主打簡單維護與快速擴充。