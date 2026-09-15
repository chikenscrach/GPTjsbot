# Configuration — 設定說明

GPTjsbot 主要透過 `.env` 與 `settings.json` 設定。敏感資訊放 `.env`；網址轉換規則放 `settings.json`。

## `.env` 基本設定

| 變數 | 必填 | 說明 | 預設 / 範例 |
| --- | :---: | --- | --- |
| `DISCORD_TOKEN` | 是 | Discord Bot Token | — |
| `CLIENT_ID` | 是 | Discord Application ID | — |
| `BOT_OWNER_ID` | 是 | Bot 擁有者 Discord User ID | — |
| `BOT_STATUS` | 否 | `online` / `idle` / `dnd` | `online` |
| `BOT_ACTIVITY_TYPE` | 否 | `Playing` / `Watching` / `Listening` / `Competing` | `Playing` |
| `BOT_ACTIVITY_NAME` | 否 | Bot 顯示的活動名稱 | `GPTjsbot \| /help` |
| `BOT_DATA_DIR` | 否 | SQLite 資料目錄 | 本地 `data/`；Docker `/app/data` |

## Groq / AI

| 變數 | 必填 | 說明 |
| --- | :---: | --- |
| `GROQ_API_KEY` | 是* | `/chat` 使用的 Groq API Key |
| `GROQ_MODEL` | 否 | 預設模型，預設 `llama-3.3-70b-versatile` |
| `GROQ_SYSTEM_PROMPT` | 否 | 自訂 AI System Prompt |

\* 如果完全不使用 AI 對話功能，可依實際部署需求處理；一般安裝建議設定。

## `/summarize` 摘要服務

| 變數 | 必填 | 說明 |
| --- | :---: | --- |
| `SUMMARIZE_API_URL` | 使用摘要時 | 外部摘要服務根網址；程式會補 `/api/summarize` |
| `SUMMARIZE_API_TOKEN` | 使用摘要時 | 與摘要服務一致的 API Token |
| `SUMMARIZE_TIMEOUT_MS` | 否 | 等待摘要服務的逾時毫秒數，預設 `150000` |

`/summarize` 每位使用者有 30 秒冷卻時間，並可透過 `private` 參數讓結果只對自己可見。

## Logger 部署旗標

| 變數 | 預設 | 用途 |
| --- | --- | --- |
| `LOGGER_MEMBERS_ENABLED` | `false` | 要求 Server Members intent，供加入／離開事件使用 |
| `LOGGER_PRESENCE_ENABLED` | `false` | 要求 Presence + Server Members intents |

接受 `true`、`1`、`yes`、`on`（不分大小寫）。

> 這兩個旗標只代表部署層允許 Bot 接收事件，不會自動替任何伺服器啟用 Logger。伺服器內仍需使用 `/logger` 設定。

## Threads

| 變數 | 預設 | 說明 |
| --- | --- | --- |
| `THREADS_MAX_PARALLEL_MEDIA` | `6` | Threads 媒體平行下載數；程式上限 10 |

## 網址轉換設定檔

`SETTINGS_FILE` 可以指定自訂設定檔：

```env
SETTINGS_FILE=./settings.json
```

未指定時：

1. 嘗試讀取專案根目錄 `settings.json`
2. 若不存在，使用內附 `settings.example.json` 的預設規則

如果你**明確指定** `SETTINGS_FILE`，但檔案不存在或格式錯誤，Bot 會停止啟動，避免意外套用錯誤設定。

詳細規則格式請看 [URL Converter](url-converter.md)。

## 建議做法

- `.env` 不要提交到 Git。
- Docker 部署時固定使用 `BOT_DATA_DIR=/app/data`，並掛載整個資料目錄。
- 自訂網址規則時，把宿主機 `settings.json` 以唯讀方式掛載到容器。
- 更新版本前先確認資料 volume／bind mount 仍指向原位置。
