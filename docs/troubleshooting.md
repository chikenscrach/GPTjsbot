# Troubleshooting — 疑難排解

## Bot 啟動後立即出現 `4014 (Disallowed intent)`

原因通常是 `.env` 開啟了 Logger privileged event，但 Discord Developer Portal 沒授權。

檢查：

- `LOGGER_MEMBERS_ENABLED=true` → 必須開 **Server Members Intent**
- `LOGGER_PRESENCE_ENABLED=true` → 必須同時開 **Presence Intent** + **Server Members Intent**

不需要這些功能時，把旗標改回 `false` 並重啟。

## Slash Command 沒出現或還是舊版本

Discord 應用程式指令不會因為程式重啟自動更新。執行：

```bash
npm run deploy
```

Docker：

```bash
docker exec gptjsbot npm run deploy
```

再確認 `CLIENT_ID` 與 Bot Token 對應到同一個 Discord Application。

## 重啟／更新後 Logger、提醒或 `/url` 設定消失

這幾類狀態都依賴 SQLite。先確認 Bot 實際使用的資料目錄：

```bash
docker exec gptjsbot node -p "require('path').resolve(process.env.BOT_DATA_DIR || '/app/data')"
```

再看容器掛載：

```bash
docker inspect gptjsbot --format '{{range .Mounts}}{{println .Type .Name .Source "->" .Destination}}{{end}}'
```

`/app/data` 應指向原本的宿主機資料夾或原 volume。不要用新的空 `./data` 取代舊資料。

如果舊容器還在，先停止寫入，再複製整個資料目錄（包含可能存在的 WAL）：

```bash
docker stop gptjsbot-old
docker cp gptjsbot-old:/app/data/. ./gptjsbot-data-recovery/
```

不要讓新舊 Bot 同時寫入同一份 SQLite。

## 自訂 `settings.json` 後 Bot 不啟動

啟動時會驗證規則。常見問題：

- JSON 格式錯誤
- `targetHost` 包含 `https://`、路徑、port 或參數
- 自訂規則缺少 `hosts` 或 `targetHost`
- 規則 ID／來源網域與專用 Handler 衝突
- 出現未知欄位
- 明確設定 `SETTINGS_FILE`，但指定檔案不存在

先用 `settings.example.json` 對照，再查看啟動 log 的具體錯誤。

## 修改 `settings.json` 後沒生效

網址規則只在 Bot 啟動時載入。修改後重啟：

```bash
docker restart gptjsbot
```

不需要重新 `npm run deploy`。

## Docker 更新時怎麼避免資料遺失？

1. 先 `docker inspect` 確認 `/app/data` 的來源。
2. 沿用原 bind mount 或原 volume。
3. `docker compose pull`。
4. `docker compose up -d` 重建服務。
5. 不要執行 `down -v`，除非你明確要刪除 volume。

完整流程見 [Deployment](deployment.md)。

## `/summarize` 無法使用

確認：

- `SUMMARIZE_API_URL` 是摘要服務根網址
- `SUMMARIZE_API_TOKEN` 與服務端一致
- 服務端可從 Bot 所在網路存取
- `SUMMARIZE_TIMEOUT_MS` 沒有設得過短

如果錯誤訊息標示可重試，稍後再次執行即可。

## 還是不確定？

建立 Issue 時建議附上：

- 部署方式（Docker Compose / Docker Run / Node.js）
- Node.js 或映像版本
- 錯誤 log（請先移除 Token、API Key、私人網址）
- 相關 `.env` **變數名稱與是否設定**，不要貼秘密值
- 重現步驟
