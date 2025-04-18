# GPTjsbot 🤖

這是一個使用 Discord.js + Node.js 製作的個人用 Discord Bot。支援 Slash 指令、網址轉換、自訂提醒、聊天與模組化指令管理，輕量易擴充，適合個人使用。

---

## 📦 安裝依賴

```bash
npm install
```

---

## ⚙️ 環境設定

請建立 `.env` 檔案，並依照下方格式填入對應資訊：

```env
DISCORD_TOKEN=你的 Discord Bot Token
CLIENT_ID=你的 Discord App Client ID
BOT_OWNER_ID=你的 Discord 使用者 ID

BOT_STATUS=online
BOT_ACTIVITY_TYPE=Playing
BOT_ACTIVITY_NAME=GPTjsbot | /help

OPENAI_API_KEY=你的 OpenAI API Key
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
├── .env                    # 環境變數（請勿上傳）
├── .env.sample             # 環境變數參考範例
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
- `/info` 查詢伺服器或使用者資訊
- `/status` 機器人上線狀況（包含記憶體、運行時間、伺服器數）
- `/reminder` 設定提醒，可選頻道或私訊
- `/chat` 與 ChatGPT 對話，支援模型選擇
- `/help` 顯示目前可用指令

---

### 💬 ChatGPT 對話（/chat）
支援模型選擇：

- `gpt-4o`
- `gpt-4o-mini`
- `gpt-3.5-turbo`（預設）

---

### 🔗 自動網址轉換
偵測訊息中的特定平台網址，自動關閉原 embed 並轉換為替代方案：

| 原始網址              | 轉換網址           |
|----------------------|--------------------|
| `x.com` / `twitter.com` | `girlcockx.com`   |
| `pixiv.net`          | `phixiv.net`       |
| `tiktok.com`         | `tnktok.com`       |
| `instagram.com`      | `ddinstagram.com`  |
| `threads.net`        | `fixthreads.net`   |
| `bsky.app`           | `fxbsky.app`       |
| 各種 `youtube.com` 或 `youtu.be` 網址 | 統一轉為 `https://youtu.be/{id}` |

✅ 僅處理來自人類使用者的訊息，忽略其他機器人送出的網址。

---

## ⚠️ 注意事項

- 使用 Discord.js v14 或更新版本。
- `.env` 請勿上傳，僅保留 `.env.sample`。
- 若出現以下警告代表寫法已棄用，請參考新版：
  ```
  Warning: Supplying "fetchReply" ... is deprecated
  Warning: Supplying "ephemeral" ... is deprecated
  ```
  → 改用 `interaction.fetchReply()` 與 `flags: InteractionResponseFlags.Ephemeral`

---

🔧 本專案為個人使用，未包含 AI 訓練或大型資料庫，主打簡單維護與快速擴充。