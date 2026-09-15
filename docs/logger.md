# Logger — 伺服器事件日誌

Logger 是選用功能。各伺服器獨立設定並保存於 SQLite；部署層的 Intent 旗標與伺服器內 `/logger` 開關是兩件不同的事。

## 支援事件

| 事件 | 記錄內容 |
| --- | --- |
| Presence | online / idle / dnd / offline 等狀態與可取得活動 |
| 成員加入 | 成員與加入時間等 metadata |
| 成員離開 | 成員與事件時間；不猜測是自行離開、踢除或封鎖 |
| 語音頻道 | 加入、離開、移動 |
| 訊息刪除 | 作者、頻道與可取得內容／附件 |
| 訊息編輯 | 作者、頻道、連結與修改內容；舊內容需原訊息已在快取中 |

## Intents 與環境變數

### 成員加入／離開

Developer Portal 開啟 **Server Members Intent**：

```env
LOGGER_MEMBERS_ENABLED=true
```

### Presence

Developer Portal 同時開啟 **Presence Intent** 與 **Server Members Intent**：

```env
LOGGER_PRESENCE_ENABLED=true
```

### 語音、訊息事件

不需要上面兩個 privileged flags。

> 如果環境旗標打開但 Discord Portal 沒授權所需 Intent，連線會因 `4014 (Disallowed intent)` 中止。

## `/logger` 指令

需要「管理伺服器」權限。

| 指令 | 用途 |
| --- | --- |
| `/logger set-channel` | 指定日誌頻道 |
| `/logger enable` | 啟用 Logger |
| `/logger disable` | 停用 Logger |
| `/logger toggle` | 切換個別事件類型 |
| `/logger exclude-channel` | 排除文字頻道、討論串或分類 |
| `/logger exclude-bots` | 切換是否記錄 Bot 事件 |
| `/logger status` | 查看目前設定 |

## 建議啟用順序

1. 視需求開啟 Portal Intent 與 `.env` 旗標。
2. 重啟 Bot。
3. 建立僅管理員可見的日誌頻道。
4. `/logger set-channel`
5. `/logger toggle` 開啟需要的事件。
6. `/logger enable`
7. `/logger status` 確認。

## 設計與限制

- **預設排除 Bot**：降低自我觸發循環風險。
- **未快取的刪除訊息**：Discord API 無法把已刪除內容重新抓回，因此只記錄可取得 metadata，未知內容會明確標示。
- **編輯前內容**：只有事件發生前已在 Discord.js 快取中的舊訊息能可靠顯示。
- **不建立聊天快照資料庫**：避免為了補未快取事件而無界限保存聊天內容。
- **成員離開原因**：同一事件涵蓋自行離開、踢除與封鎖，不在沒有可靠資訊時推測原因或操作者。
- **語音隱私**：只記錄頻道狀態變化，不擷取、錄製或分析語音內容。
- **排除頻道**：若語音移動的來源或目的地任一端被排除，整筆事件都不記錄，避免從另一端洩漏活動。

## 重啟後設定消失？

Logger 設定正常情況會保存在 SQLite。若重啟後回到預設，通常是 `BOT_DATA_DIR` 或 Docker volume 指向新的空資料庫。

請看 [Troubleshooting](troubleshooting.md) 的「重啟後資料消失」。
