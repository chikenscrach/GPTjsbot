# Installation — 安裝前準備

這一頁處理第一次部署前需要準備的 Discord 與 API 設定。完成後再進入 [Deployment](deployment.md)。

## 1. 建立 Discord Application

1. 前往 Discord Developer Portal。
2. 建立新的 Application。
3. 在 **Bot** 頁面建立 Bot，取得 `DISCORD_TOKEN`。
4. 在 **General Information** 取得 Application ID，填入 `CLIENT_ID`。
5. 取得自己的 Discord User ID，填入 `BOT_OWNER_ID`。

> Token 等同帳號密碼，不要提交到 Git、Issue、Log 或公開聊天室。專案已提供 `.env.sample`，請複製成自己的 `.env`。

## 2. 開啟必要 Intents

### 必要

為了讓 Bot 讀取一般訊息並偵測網址，請在 Developer Portal → **Bot → Privileged Gateway Intents** 開啟：

- **Message Content Intent**

### Logger 選用

只有需要對應 Logger 功能時才開：

- 成員加入／離開：**Server Members Intent** + `LOGGER_MEMBERS_ENABLED=true`
- Presence：**Presence Intent** + **Server Members Intent** + `LOGGER_PRESENCE_ENABLED=true`
- 語音頻道事件不需要 privileged intent

如果環境變數要求 Discord 傳送 privileged event，但 Portal 沒有授權，Discord 會以 `4014 (Disallowed intent)` 中斷連線。

## 3. 邀請 Bot 到伺服器

在 Developer Portal 的 OAuth2 URL Generator 建立邀請連結，至少包含：

- `bot`
- `applications.commands`

實際 Bot 權限請依你要使用的功能授予。Logger、訊息回覆與網址轉換需要 Bot 能查看及發送對應頻道訊息；不要為了方便直接給不必要的 Administrator 權限。

## 4. 準備 Groq API

AI `/chat` 功能使用 Groq API。取得 API Key 後填入：

```env
GROQ_API_KEY=你的 Groq API Key
```

可用 `GROQ_MODEL` 指定預設模型，完整說明見 [Configuration](configuration.md)。

## 5. 網頁摘要功能（選用）

`/summarize` 會呼叫外部摘要服務；如果要使用，還需要設定：

```env
SUMMARIZE_API_URL=https://你的摘要服務
SUMMARIZE_API_TOKEN=與摘要服務相同的 API Token
```

未部署摘要服務時，其餘功能仍可使用。

## 6. 建立 `.env`

```bash
cp .env.sample .env
```

最低限度先填：

```env
DISCORD_TOKEN=...
CLIENT_ID=...
BOT_OWNER_ID=...
GROQ_API_KEY=...
```

接著前往：

- [Configuration](configuration.md)：看完整設定
- [Deployment](deployment.md)：啟動 Bot
