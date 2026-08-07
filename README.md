# GPTjsbot 🤖

<p align="center">
  <img src="https://img.shields.io/badge/Container-GHCR-blue?style=flat-square&logo=github" alt="GHCR">
  <img src="https://img.shields.io/badge/Node.js->=20.0.0-green?style=flat-square&logo=node.js" alt="Node.js Version">
  <img src="https://img.shields.io/badge/Discord.js-v14-blue?style=flat-square&logo=discord" alt="Discord.js Version">
  <img src="https://img.shields.io/badge/Docker-Supported-blue?style=flat-square&logo=docker" alt="Docker">
  <img src="https://img.shields.io/github/license/chikenscrach/GPTjsbot?style=flat-square" alt="License">
</p>

<p align="center">
  <strong>基於 Discord.js v14 + Node.js 的全能型個人 Discord 機器人。</strong><br>
  整合 <b>Groq AI 聊天（支援自訂模型）</b>、<b>多平台網址自動修復 (Embed Fixer)</b>、<b>SQLite 提醒系統</b>，並支援 <b>Docker 容器化部署</b>。
</p>

---

## 🌟 核心特色

*   🤖 **AI 智慧聊天**：整合 **Groq API**，支援極速的 Llama / Mixtral 等模型對話，內建 SQLite 記憶對話上下文，自動翻譯繁體中文，且**完美支援長訊息自動分段發送**，徹底防範 Discord 2000 字元長度限制。
*   ⚙️ **可自訂對話模型**：模型不再寫死！開發者可在 `.env` 檔案中設定全域預設模型，使用者也可以直接在 `/chat` 指令的選單中即時切換不同的官方模型（如極速的 Llama 8B、強大的 Llama 3.3 70B、GPT OSS 或是 Qwen3 等官方支援模型）。
*   🔗 **自動網址轉換 (Embed Fixer)**：當使用者發送特定平台（如 X/Twitter, Instagram, Facebook）網址時，機器人會自動修正為可直接預覽影片/多圖的替代服務網址（例如 `fixvx.com`, `kkinstagram.com` 等）。
*   🎯 **Discord 任務查詢 (Quest)**：即時抓取社群維護的任務資料，支援分頁列表、名稱／獎勵／ID／月份搜尋與 Orb 統計，並可用**獎勵類型、地區限制、年齡限制、連動任務等多重條件交叉篩選**，快速找出「還沒過期、有 Orb 又沒有地區限制」的任務。
*   ⏰ **輕量化提醒系統**：透過內建的 SQLite 與排程器，隨時設定個人/頻道的定時提醒事項。
*   📋 **伺服器事件日誌 (Logger)**：可選擇性啟用的事件監測系統，由伺服器管理員指定一個頻道接收成員上線/下線、訊息刪除、批次刪除與訊息編輯等通知，支援排除特定頻道與機器人事件；訊息已在快取中時可附帶原文，未快取時仍會記錄可取得的 metadata 並清楚標示內容未知。
*   🐋 **生產級 Docker 支援**：基於 `node:20-slim` 進行多階段建置 (Multi-stage build)，內建 `tini` 防範殭屍進程，並以非 root 權限 (`appuser`) 安全運行。已自動發佈至 **GitHub Container Registry (GHCR)**。
*   🧩 **模組化架構**：易於擴充，只需在 `commands/` 或 `handlers/` 目錄新增檔案，即可無痛增加新指令與新網址解析規則。

---

## 🛠️ 前置準備

### 1. 取得 API 金鑰與 Token
*   **Discord Bot Token**：請至 [Discord Developer Portal](https://discord.com/developers/applications) 建立 Application 並取得 Token。
*   **Groq API Key**：請至 [Groq Console](https://console.groq.com/) 免費申請。

### 2. 開啟 Discord Intents ⚠️（重要）

為了讓機器人偵測網址與讀取訊息內容，請在 Discord Developer Portal 的 **Bot** 分頁啟用：

- [x] **Message Content Intent**（若未開啟，網址自動轉換等功能無法讀取訊息內容）

Logger 的上線狀態監測是選用功能。只有要啟用它時，才需要另外在 Portal 同時開啟以下兩個 privileged intents，並在 `.env` 設定 `LOGGER_PRESENCE_ENABLED=true`：

- [x] **Presence Intent**
- [x] **Server Members Intent**

> `LOGGER_PRESENCE_ENABLED` 預設為 `false`，此時 Bot 不會向 Discord 要求上述兩個 intents，訊息刪除與編輯日誌仍可使用。若只設定環境變數卻未在 Portal 授權兩個 intents，Discord 會以 `4014 (Disallowed intent)` 中斷連線。

---

## ⚙️ 環境變數設定 (`.env`)

請在專案根目錄建立 `.env` 檔案（可參考 `.env.sample`）：

| 變數名稱 | 是否必填 | 說明 | 預設值 / 範例 |
| :--- | :---: | :--- | :--- |
| `DISCORD_TOKEN` | **是** | 你的 Discord Bot Token | `MTIzNDU2...` |
| `CLIENT_ID` | **是** | 你的 Discord Application Client ID | `123456789012345678` |
| `BOT_OWNER_ID` | **是** | 機器人擁有者的 Discord User ID | `876543210987654321` |
| `GROQ_API_KEY` | **是** | Groq API Key | `gsk_abc123...` |
| `GROQ_MODEL` | 否 | AI 聊天預設模型 | `llama-3.3-70b-versatile` |
| `GROQ_SYSTEM_PROMPT` | 否 | 自訂 AI 的角色設定 (System Prompt) | `你是一位專業且親切的 Discord 智慧助手...` |
| `BOT_STATUS` | 否 | 機器人狀態 (`online`, `idle`, `dnd`) | `online` |
| `BOT_ACTIVITY_TYPE` | 否 | 活動類型 (`Playing`, `Watching`, `Listening`) | `Playing` |
| `BOT_ACTIVITY_NAME` | 否 | 狀態欄顯示文字 | `GPTjsbot | /help` |
| `LOGGER_PRESENCE_ENABLED` | 否 | 是否向 Discord 要求 Presence 與 Server Members intents；接受 `true`、`1`、`yes`、`on`（不分大小寫） | `false` |

---

## 🚀 部署與執行

您可以選擇使用 Docker 直接拉取官方封裝好的 GHCR 映像檔（最推薦、最快速），或是使用傳統 Node.js 本地部署。

### 方案 A：使用 Docker 部署（推薦 🐳）

本專案已發佈至 **GitHub Container Registry (GHCR)**。您無需自行建置（Build）映像檔，可直接拉取 (Pull) 官方映像檔快速啟動。

#### 1. 拉取 GHCR 映像檔
```bash
docker pull ghcr.io/chikenscrach/gptjsbot:latest
```

#### 2. 啟動容器
您可以選擇使用 **Docker Compose**（極力推薦，方便管理）或傳統的 **Docker Run**。

##### 💡 方式一：使用 Docker Compose（極佳維護性）
在根目錄下建立 `docker-compose.yml` 檔案：
```yaml
services:
  gptjsbot:
    image: ghcr.io/chikenscrach/gptjsbot:latest
    container_name: gptjsbot
    restart: unless-stopped
    env_file:
      - .env
    volumes:
      - ./data:/app/data
```
啟動服務：
```bash
docker-compose up -d
```

##### 💡 方式二：使用 Docker Run 傳統啟動
```bash
docker run -d \
  --name gptjsbot \
  --env-file .env \
  -v ./data:/app/data \
  ghcr.io/chikenscrach/gptjsbot:latest
```

> ⚠️ **注意事項：** 
> * 請務必掛載 `-v ./data:/app/data`，這樣內建的 SQLite 資料庫 (`bot.db`) 在容器升級或重啟時，數據（如對話上下文、提醒設定）才不會遺失。
> * 請確認宿主機的 `./data` 資料夾具備正確的讀寫權限。

---

### 方案 B：傳統 Node.js 本地部署

1. **安裝依賴套件**
   ```bash
   npm install
   ```

2. **註冊 Slash (斜線) 指令**
   每當新增、修改指令或首次啟動時，請先執行此步驟：
   ```bash
   node core/deploy-commands.js
   ```

3. **啟動機器人**
   ```bash
   node index.js
   ```

---

## 📁 專案結構說明

```text
GPTjsbot/
├── commands/               # Slash 指令模組 (自動讀取)
│   ├── chat.js             # AI 聊天 (/chat，支援自訂模型選單)
│   ├── reminder.js         # 設定提醒 (/reminder)
│   ├── quest.js            # Discord 任務查詢 (/quest，列表／搜尋／統計)
│   ├── logger.js           # 伺服器事件日誌設定 (/logger)
│   └── ...                 # ping, avatar, info, status, help
├── core/                   # 核心調度邏輯
│   ├── chat.js             # Groq API 封裝與可配置模型邏輯
│   ├── db.js               # SQLite 資料庫初始化（含 logger_settings 資料表）
│   ├── deploy-commands.js  # Discord 斜線指令部署腳本
│   ├── logger.js           # Logger 共用模組（設定讀寫、Embed 建構）
│   └── scheduler.js        # 定時提醒任務排程器
├── events/
│   ├── messageCreate.js    # 監聽訊息（負責網址偵測與轉換）
│   ├── presenceUpdate.js   # 監聽成員上線狀態變更（Logger）
│   ├── messageDelete.js    # 監聽訊息刪除事件（Logger）
│   ├── messageBulkDelete.js # 監聽批次訊息刪除事件（Logger）
│   └── messageUpdate.js    # 監聽訊息編輯事件（Logger）
├── handlers/               # 網址解析與格式修復模組 (Modular Handlers)
│   ├── facebook.js         # 處理 Facebook 貼文、多圖與小幫手
│   ├── twitter.js          # 轉換 Twitter / X 連結至 Fixvx
│   ├── threads.js          # 清理 Threads 網址與追蹤參數
│   ├── simple.js           # Pixiv, IG, Bilibili 等簡單取代規則
│   ├── youtube.js          # YouTube 轉簡短網址
│   └── index.js            # 集中匯出網址處理器
├── data/
│   └── bot.db              # SQLite 本地資料庫 (自動產生)
├── Dockerfile              # 多階段、高安全性的 Docker 映像檔建置規則
├── LICENSE                 # 開源授權條款 (MIT)
└── index.js                # 專案程式入口點
```

---

## 📖 功能清單

### 🤖 斜線指令 (Slash Commands)
*   `/chat [message] [model]`：與 AI 助手對話。
    *   `message`：對話內容。
    *   `model`（選填）：直接在選單中覆寫預設設定，即時選用不同模型（如 Llama 3.3 70B、Llama 3.1 8B、GPT OSS 120B、Qwen 3.6 27B 等）。
*   `/reminder [time] [message] [channel]`：設定定時提醒，時間格式支援 `10m`、`2h`、`1d` 等。
*   `/quest list`：顯示 Discord 任務列表，預設只列出**進行中**的任務，並依開始時間由新到舊排序。
    *   `page`（選填）：頁數。
    *   `expired`（選填）：一併列出已過期的任務。
    *   `expiring`（選填）：改依到期時間排序（最快到期的排在最前面）。
    *   `reward_type`（選填）：只看指定獎勵類型的任務（`Orb`、`頭像裝飾`、`Nitro`、`兌換碼`、`遊戲內獎勵`）。
    *   `regions` / `age` / `linked` / `restricted`（選填）：只看有**地區限制**／**年齡限制**／**連動任務**／**任何限制**的任務。
    *   💡 **以上條件皆可自由組合，同時指定時必須全部符合 (AND)**。例如 `/quest list reward_type:Orb regions:True` 會列出「有地區限制的 Orb 任務」；再加上 `expiring:True` 就能優先看到快到期的那幾個。
*   `/quest search`：搜尋任務，`name`（名稱）、`reward`（獎勵名稱）、`id`（任務 ID）、`month`（開始月份，格式 `MM/YY`，例如 `07/26`）四選一填寫。
    *   依**名稱**或**月份**搜尋時固定包含已過期任務；依**獎勵**或 **ID** 搜尋則可用 `expired` 決定是否納入。
*   `/quest stats [type]`：顯示任務統計，可選擇「全部統計」（任務總數、各獎勵類型與任務類型分佈）或「Orb 統計」（Orb 總數、進行中可取得的 Orb 數量）。
*   `/status`：診斷並顯示當前系統狀態（包含記憶體佔用、運行時間與延遲）。
*   `/ping`：測試機器人與 Discord API 的延遲。
*   `/avatar [user]`：取得指定使用者的頭像。
*   `/info`：取得伺服器或使用者詳細資訊。
*   `/help`：列出所有可用指令。

### 📋 伺服器事件日誌 (`/logger`)

> ⚠️ **使用前須知**：Logger 的「上線狀態監測」依賴 Discord 的 **Presence Intent** 與 **Server Members Intent**。請先在 Developer Portal → Bot 分頁同時開啟兩者，再設定 `LOGGER_PRESENCE_ENABLED=true` 並重啟 Bot。未設定旗標時只停用 presence 監測，不影響訊息事件日誌。

此功能為**選擇性啟用**，預設關閉。啟用後，機器人會在指定的頻道中即時推送伺服器內的事件訊息（Embed 格式，依事件類型以顏色區分）：

| 事件類型 | 顏色 | 記錄內容 |
| :--- | :---: | :--- |
| 🟢 上線狀態變更 | 綠 / 紅 / 黃 | 成員上線、閒置、勿擾、離線切換，附時間戳記與當前活動 |
| 🗑️ 訊息刪除／批次刪除 | 紅 | 作者、所在頻道與可取得的訊息內容／附件；未快取時內容標示為未知 |
| ✏️ 訊息編輯 | 黃 | 作者、頻道、訊息連結與修改後內容；只有已快取舊訊息才能顯示可靠的「修改前」內容 |

#### 子指令一覽（需具備「管理伺服器」權限）

*   `/logger enable`：啟用日誌功能（須先設定頻道）。
*   `/logger disable`：停用日誌功能。
*   `/logger set-channel <channel>`：指定接收日誌訊息的文字或公告頻道。
*   `/logger toggle <event>`：開關個別事件類型（`presence` / `delete` / `update`）。
*   `/logger exclude-channel <channel>`：將指定頻道、討論串或分類加入／移出「不記錄」清單；排除父頻道或分類時也會排除其下的討論串。
*   `/logger exclude-bots`：切換是否記錄機器人產生的事件（預設排除，避免自我觸發循環）。
*   `/logger status`：檢視目前設定（含頻道、各事件狀態、排除清單）。

#### 快速啟用流程

1.  若需 presence 日誌，先在 Discord Developer Portal 同時開啟 **Presence Intent**、**Server Members Intent**，在 `.env` 設定 `LOGGER_PRESENCE_ENABLED=true` 後重啟 Bot；不需要此功能可略過。
2.  在伺服器中建立一個專門用來接收日誌的頻道（建議設為管理員可見）。
3.  執行 `/logger set-channel` 並選擇該頻道。
4.  視需求執行 `/logger toggle` 調整要監測的事件類型。
5.  執行 `/logger enable` 啟用。完成後可隨時用 `/logger status` 檢視設定。

#### 設計考量

*   **避免循環**：預設排除所有機器人事件，避免機器人發送日誌訊息時又被自己記錄。
*   **長訊息保護**：訊息內容超過 1000 字元會自動截斷並附「…(已截斷)」後綴，避免 Embed 欄位超過 Discord 1024 字元上限。
*   **partial 訊息處理**：Bot 會 fetch 更新後的訊息，但 Discord API 無法取回已刪除內容，也無法藉由 fetch 還原編輯前版本。因此只有事件發生前已在 Discord.js 快取中的訊息能可靠顯示原文；未快取事件仍會記錄 Message ID、頻道等可取得的 metadata，未知內容會明確標示，不會偽稱完整。
*   **資料最小化**：Logger 不會為了補足未快取事件而另建無界限的聊天內容快照資料庫。
*   **每伺服器獨立設定**：設定以伺服器為單位儲存於 SQLite，各伺服器互不影響。

### 🔗 自動網址轉換對照表 (Embed Fixer)
當一般使用者發送以下平台網址時，機器人會**自動刪除原先失效或難看的預覽**，並改寫為能完美呈現影音預覽的替代連結：

| 原始網址 | 轉換後網址 (修復預覽) | 備註說明 |
| :--- | :--- | :--- |
| `x.com` / `twitter.com` | `fixvx.com` | 完美還原 X 影片與多圖預覽 |
| `pixiv.net` | `phixiv.net` | 解決 Pixiv 圖片無法直接在 Discord 顯示的問題 |
| `tiktok.com` | `tnktok.com` | 支援 TikTok 影片在 Discord 內直接播放 |
| `instagram.com` | `kkinstagram.com` | 修正 IG 貼文、Reels 影片無法預覽的問題 |
| `bsky.app` | `fxbsky.app` | 修正 Bluesky 預覽 |
| `bilibili.com` / `b23.tv` | `vxbilibili.com` / `vxb23.tv` | 修正 B 站影片預覽 |
| `threads.net` | `threads.com` | 移除 `www.` 與惱人的 `?xpt=` 追蹤參數 |
| `facebook.com` / `fb.watch` | `facebed.com` | 自動解析真實貼文 ID，排除登入牆限制 |
| `youtube.com` | `youtu.be` | 自動標準化為 YouTube 短網址 |

---

## 🛠️ 開發與擴充指南

本專案架構完全模組化，您可以極其輕鬆地擴充它：

### 如何新增一個 Slash 指令？
1. 在 `commands/` 資料夾下建立一個新的 `.js` 檔案（例如 `hello.js`）。
2. 匯出符合 Discord.js 規範的指令結構：
   ```javascript
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
3. 重新執行 `node core/deploy-commands.js` 註冊指令，並重啟 Bot。

### 如何新增網址轉換規則？
*   如果是**簡單的域名替換**：直接編輯 `handlers/simple.js` 裡的 `domainMap`。
*   如果是**複雜的 API 解析**：在 `handlers/` 下建立新的處理器檔案，並在 `handlers/index.js` 中註冊即可。

---

## 📄 授權條款

本專案採用 [MIT License](LICENSE) 進行授權。歡迎自由 Fork、修改與分享！
