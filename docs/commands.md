# Commands — 指令一覽

> 指令有新增或修改時，需執行 `npm run deploy`（Docker：`docker exec gptjsbot npm run deploy`）後才會更新 Discord 的應用程式指令。

## 一般指令

| 指令 | 用途 |
| --- | --- |
| `/chat` | 與 AI 助手對話，可選模型 |
| `/summarize url:<網址> [private]` | 擷取網頁並由外部摘要服務整理重點 |
| `/reminder` | 設定定時提醒 |
| `/quest` | 查詢、搜尋與統計 Discord Quest |
| `/status` | 顯示運行時間、記憶體與延遲 |
| `/ping` | 測試 Discord API 延遲 |
| `/avatar` | 取得使用者頭像 |
| `/info` | 查看伺服器或使用者資訊 |
| `/help` | 顯示可用指令 |

## `/quest`

### `/quest list`

預設列出進行中的任務，可使用：

- `page`：頁數
- `expired`：包含已過期任務
- `expiring`：依到期時間排序
- `reward_type`：例如 Orb、頭像裝飾、Nitro、兌換碼、遊戲內獎勵
- `regions` / `age` / `linked` / `restricted`：依地區、年齡、連動或限制條件篩選

多個條件同時指定時採 AND 邏輯。

### `/quest search`

可依名稱、獎勵、任務 ID 或月份搜尋。月份格式為 `MM/YY`。

### `/quest stats`

可查看全部統計或 Orb 統計。

## `/summarize`

```text
/summarize url:https://example.com private:True
```

- `url`：必填，只接受 `http://` 或 `https://` 網址
- `private`：選填；開啟後結果只對操作者可見
- 每位使用者有 30 秒冷卻時間

需要先設定 `SUMMARIZE_API_URL` 與 `SUMMARIZE_API_TOKEN`，見 [Configuration](configuration.md)。

## 管理指令

### `/url`

管理每個伺服器的網址轉換總開關與個別規則。詳見 [URL Converter](url-converter.md)。

### `/logger`

設定伺服器事件日誌、頻道、排除規則與事件開關。詳見 [Logger](logger.md)。

## 右鍵選單：刪除網址轉換訊息

對 Bot 產生的網址轉換訊息按右鍵 → **應用程式 → 刪除訊息**。

原本貼出網址的成員，或在該頻道有「管理訊息」權限的管理員／Mod 可以使用。操作只會刪除選中的 Bot 回覆，不會刪除原始使用者訊息。
