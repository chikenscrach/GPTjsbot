# GPTjsbot 🤖

這是一個使用 Discord.js + Node.js 製作的個人用 Discord Bot。支援 Slash 指令，並規劃輕量化、模組化指令管理，適合開發與擴充。

## 📦 安裝依賴

```bash
npm install
```

## ⚙️ 環境設定

請建立 `.env` 檔案，並依照下方格式填入對應資訊：

```env
DISCORD_TOKEN=你的 Discord Bot Token
CLIENT_ID=你的 Discord App Client ID
BOT_OWNER_ID=你的 Discord 使用者 ID
BOT_STATUS=online|idle|dnd
BOT_ACTIVITY=你想顯示的活動狀態文字
```

或參考 `.env.sample` 範本檔案。

## 🚀 註冊 Slash 指令

指令會依照 `commands/` 資料夾內的 `.js` 檔自動註冊：

```bash
node core/deploy-commands.js
```

## 🧪 啟動機器人

```bash
node index.js
```

## 📁 專案結構

```
GPTjsbot/
├── core/                     # 核心功能模組
│   └── deploy-commands.js
├── commands/                 # Slash 指令模組
│   ├── avatar.js
│   ├── info.js
│   ├── ping.js
│   ├── reminder.js
│   └── status.js
├── .env                      # 環境變數（請勿上傳）
├── .env.sample               # 環境變數參考範例
├── .gitignore
├── index.js                  # Bot 入口主程式
├── package.json
└── README.md
```

## ⚠️ 注意事項

- 本專案使用 Discord.js v14 或更新版本，請留意 API 變動。
- 若執行時出現類似下方警告：

```
Warning: Supplying "fetchReply" ... is deprecated
Warning: Supplying "ephemeral" ... is deprecated
```

建議參考新版寫法改用：
- `interaction.fetchReply()` 取代 `fetchReply: true`
- 使用 `flags: InteractionResponseFlags.Ephemeral` 取代 `ephemeral: true`

---

🔧 專案為個人開發用途，未使用機器學習模組與複雜資料庫架構，主打易於維護與擴充。