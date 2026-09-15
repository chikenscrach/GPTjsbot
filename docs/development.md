# Development — 開發與擴充

## 專案結構

```text
GPTjsbot/
├── commands/        # Slash Command 與右鍵指令
├── core/            # Discord 互動、資料庫、排程與核心服務
├── events/          # Discord Event handlers
├── handlers/        # URL 解析與轉換 handlers
├── utils/           # 共用工具
├── docs/            # 使用與維護文件
├── data/            # SQLite 資料目錄
├── settings.example.json
├── compose.example.yaml
├── Dockerfile
└── index.js
```

## 開發環境

Node.js 22+：

```bash
npm install
npm test
npm start
```

修改 Discord Application Command 後：

```bash
npm run deploy
```

## 新增 Slash Command

在 `commands/` 建立模組，例如：

```js
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

完成後重新 `npm run deploy` 並重啟 Bot。

## 新增簡單網址轉換

如果只需要換 hostname，不要新增程式碼；直接在 `settings.json` 新增規則：

```json
{
  "urlConversion": {
    "rules": {
      "example": {
        "enabled": true,
        "hosts": ["example.com"],
        "targetHost": "preview.example.com",
        "stripQuery": false
      }
    }
  }
}
```

這樣新規則會自動加入 `/url` 的管理範圍，不需要重新 deploy 指令。

## 新增複雜 URL Handler

需要解析 API、改寫路徑或取得媒體時，才在 `handlers/` 建立專用 Handler。

Handler 應提供專案既有介面所需的識別與解析邏輯（例如 `name`、`match`、`resolve`），並避免與 `settings.json` 的規則 ID 或來源網域衝突。

可先參考現有：

- `handlers/twitter.js`
- `handlers/facebook.js`
- `handlers/threads.js`
- `handlers/youtube.js`
- `handlers/simple.js`

## 文件維護原則

為了讓 README 保持易讀：

- README：專案介紹、核心特色、Quick Start、文件入口
- `docs/`：完整操作與維護細節
- 新增功能時，至少同步更新 `docs/commands.md` 或對應專頁
- 新增 `.env` 變數時，同步更新 `.env.sample` 與 `docs/configuration.md`
- 新增部署需求時，同步更新 `docs/deployment.md`

這套結構也方便未來直接把 `docs/*.md` 搬到 GitHub Wiki，而不需要重新拆解 README。
