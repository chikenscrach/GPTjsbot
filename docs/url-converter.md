# URL Converter — 網址轉換與 Embed Fixer

GPTjsbot 可把常見平台網址轉成更適合 Discord 預覽的網址，或由專用 Handler 直接產生媒體預覽。

## 內附平台

| 原始平台 | 預設處理方式 |
| --- | --- |
| X / Twitter | `fixvx.com` |
| Pixiv | `phixiv.net` |
| TikTok | `tnktok.com` |
| Instagram | `kkinstagram.com` |
| Bluesky | `fxbsky.app` |
| Bilibili | `vxbilibili.com` / `vxb23.tv` |
| Threads | 專用 Handler 產生媒體預覽並清理網址 |
| Facebook | 專用 Handler 解析並使用替代預覽 |
| YouTube | 專用 Handler 標準化短網址 |

### Threads 互動次數

Threads 預覽會在 embed 底部依序顯示愛心、留言、轉發與分享次數，例如：

`Threads • ❤️ 1,234 • 💬 56 • 🔁 7 • ✈️ 8`

轉發次數包含一般轉發與引用轉發，與 Threads 頁面的按鈕一致。數字是產生預覽時取得的資料，不會自動更新；頁面未提供的項目顯示 `—`，實際為零則顯示 `0`。媒體過大或下載失敗的提示仍會保留在底部。

### Threads 大型影片

影片在 10MiB 以內時，Bot 會下載並上傳為 Discord 附件。超過上限時會停止下載，改用額外的 Media Gallery 訊息直接引用 Threads CDN 播放，每批最多 10 支影片，並保留貼文預覽與互動次數。

CDN 網址從貼文資料取得，會保留完整簽名參數。播放仍取決於 Discord 能否讀取該網址；連結可能過期，無法播放時可用影片下方的「開啟原文」按鈕。超限圖片與下載失敗的媒體仍顯示原有提示。

Media Gallery 使用 [Discord Components V2](https://docs.discord.com/developers/components/reference#media-gallery)，與一般 embed 分開發送；Bot 不會重新上傳超限影片。

### Facebook 相片與群組文章

`/photo/?fbid=...`、`/photo.php?fbid=...` 與 `/{發布者}/photos/...` 會嘗試從外嵌頁還原相片所屬文章。群組相片若只提供 `set=gm.<母貼文ID>`，會再追蹤該貼文 ID 的重新導向，確認 ID 相符後轉成 `https://facebed.com/groups/{群組}/posts/{母貼文ID}`。

例如 `https://www.facebook.com/photo/?fbid=2169155400677688` 可還原為 `https://facebed.com/groups/zenlesszonezeroglobal1/posts/1397664659240620`。無法確認所屬群組時，保留相片網址作為備援。

### Facebook 影片網址

`/{發布者}/videos/{標題}/{影片ID}`、`/{發布者}/videos/{影片ID}` 與 `/watch/?v={影片ID}` 會統一轉成 `https://facebed.com/watch/?v={影片ID}`，移除標題與追蹤參數。

`/share/v/...`、`fb.watch` 分享連結會先追蹤重新導向，再從頁面 metadata、最終網址或登入頁的 `next` 參數辨識影片 ID；辨識成功後，不必再請求貼文外嵌頁。

## 簡單規則：`settings.json`

建立自己的設定：

```bash
cp settings.example.json settings.json
```

只想把 Instagram 目標改成 `oginstagram.com`：

```json
{
  "urlConversion": {
    "rules": {
      "instagram": {
        "targetHost": "oginstagram.com"
      }
    }
  }
}
```

也能加入自己的簡單網域替換：

```json
{
  "urlConversion": {
    "rules": {
      "custom": {
        "enabled": true,
        "hosts": ["source.example", "m.source.example"],
        "targetHost": "preview.example",
        "stripQuery": false
      }
    }
  }
}
```

這類規則只替換網域，保留協定、路徑與 fragment。若 `stripQuery` 為 `false`，query string 也會保留。

## 規則欄位

| 欄位 | 說明 |
| --- | --- |
| 規則 ID | 固定識別字，供資料庫與 `/url` 使用；改目標網域時建議保留 ID |
| `enabled` | 預設是否啟用 |
| `hosts` | 來源網域陣列 |
| `targetHost` | 目標網域，不含協定、路徑、port 或參數 |
| `stripQuery` | 是否移除 `?` 後 query string |

設定以規則 ID 與內附預設合併。省略內建欄位時會沿用預設；新增自訂規則則必須提供 `hosts` 與 `targetHost`。

## 專用 Handler 開關

`twitter`、`facebook`、`threads`、`youtube` 可透過：

```json
{
  "urlConversion": {
    "handlers": {
      "threads": { "enabled": false }
    }
  }
}
```

這只調整預設開關，不會把 Handler 的解析程式搬進設定檔。

## `/url` 伺服器開關

需要「管理伺服器」權限。

| 指令 | 行為 |
| --- | --- |
| `/url enable` | 啟用目前伺服器總開關 |
| `/url disable` | 暫停目前伺服器全部轉換 |
| `/url toggle target:<規則>` | 切換個別平台／規則 |
| `/url reset target:<規則>` | 清除該伺服器覆寫，回到設定檔預設 |
| `/url status` | 查看總開關、個別規則與設定來源 |

個別規則優先順序：

1. 伺服器覆寫
2. `settings.json` / 內附預設

Discord 內 `/url` 的操作會寫入 SQLite，不會修改 JSON 檔案。

## 修改設定後要不要 `npm run deploy`？

不用。規則與目標網域在 Bot 啟動時載入，修改 `settings.json` 後**重啟 Bot**即可。

只有新增／修改 Slash Command 本身時才需要重新 deploy。

## 什麼時候要寫 Handler？

適合 `settings.json`：

- 只換 hostname
- 路徑格式完全相同
- 不需要抓頁面或 API

需要 `handlers/`：

- 要改寫路徑
- 要呼叫 API
- 要解析網頁
- 需要額外媒體或特殊 Discord 回覆

開發方式見 [Development](development.md)。
