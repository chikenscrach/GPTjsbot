# GPTjsbot 🤖

<p align="center">
  <img src="https://img.shields.io/badge/Container-GHCR-blue?style=flat-square&logo=github" alt="GHCR">
  <img src="https://img.shields.io/badge/Node.js->=22.0.0-green?style=flat-square&logo=node.js" alt="Node.js Version">
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
*   🔗 **自動網址轉換 (Embed Fixer)**：當使用者發送特定平台（如 X/Twitter, Instagram, Facebook）網址時，機器人會自動修正為可直接預覽影片/多圖的替代服務網址（例如 `fixvx.com`, `kkinstagram.com` 等）。簡單轉換可透過 `settings.json` 更換網域或新增規則，各伺服器可用 `/url` 管理開關。
*   🎯 **Discord 任務查詢 (Quest)**：即時抓取社群維護的任務資料，支援分頁列表、名稱／獎勵／ID／月份搜尋與 Orb 統計，並可用**獎勵類型、地區限制、年齡限制、連動任務等多重條件交叉篩選**，快速找出「還沒過期、有 Orb 又沒有地區限制」的任務。
*   ⏰ **輕量化提醒系統**：透過內建的 SQLite 與排程器，隨時設定個人/頻道的定時提醒事項。
*   📋 **伺服器事件日誌 (Logger)**：可選擇性啟用的事件監測系統，由伺服器管理員指定頻道接收成員上線狀態、加入／離開、語音頻道移動，以及訊息刪除與編輯等通知。支援排除特定頻道與機器人事件；訊息已在快取中時可附帶原文，未快取時仍會記錄可取得的 metadata 並清楚標示內容未知。
*   🐋 **生產級 Docker 支援**：基於 `node:22.23.1-bookworm-slim` 進行多階段建置 (Multi-stage build)，內建 `tini` 防範殭屍進程，並以非 root 權限 (`appuser`) 安全運行。已自動發佈至 **GitHub Container Registry (GHCR)**。
*   🧩 **模組化架構**：易於擴充，只需在 `commands/` 或 `handlers/` 目錄新增檔案，即可無痛增加新指令與新網址解析規則。

---

## 🛠️ 前置準備

### 1. 取得 API 金鑰與 Token
*   **Discord Bot Token**：請至 [Discord Developer Portal](https://discord.com/developers/applications) 建立 Application 並取得 Token。
*   **Groq API Key**：請至 [Groq Console](https://console.groq.com/) 免費申請。

### 2. 開啟 Discord Intents ⚠️（重要）

為了讓機器人偵測網址與讀取訊息內容，請在 Discord Developer Portal 的 **Bot** 分頁啟用：

- [x] **Message Content Intent**（若未開啟，網址自動轉換等功能無法讀取訊息內容）

Logger 的 presence 與成員加入／離開監測是部署層級的選用功能：

- 成員加入／離開：在 Portal 開啟 **Server Members Intent**，並設定 `LOGGER_MEMBERS_ENABLED=true`。
- Presence：在 Portal 同時開啟 **Presence Intent** 與 **Server Members Intent**，並設定 `LOGGER_PRESENCE_ENABLED=true`。
- 語音頻道加入／離開／移動使用非 privileged 的 `GuildVoiceStates` intent，不需額外環境旗標。

> 兩個 `LOGGER_*_ENABLED` 旗標預設皆為 `false`。若將旗標打開，卻未在 Portal 授權其所需的 privileged intent，Discord 會以 `4014 (Disallowed intent)` 中斷連線。這些旗標未啟用時，訊息與語音事件日誌仍可使用。

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
| `BOT_DATA_DIR` | 否 | SQLite 資料目錄；建議固定絕對路徑，重啟或更新時沿用同一份資料 | 本地：專案的 `data/`；Docker：`/app/data` |
| `SETTINGS_FILE` | 否 | 網址規則設定檔；相對路徑以專案根目錄為基準，指定後檔案必須存在 | 專案根目錄的 `settings.json`；Docker：`/app/settings.json` |
| `LOGGER_PRESENCE_ENABLED` | 否 | 是否向 Discord 要求 Presence 與 Server Members intents；接受 `true`、`1`、`yes`、`on`（不分大小寫） | `false` |
| `LOGGER_MEMBERS_ENABLED` | 否 | 是否向 Discord 要求 Server Members intent 並接收成員加入／離開事件；接受 `true`、`1`、`yes`、`on`（不分大小寫） | `false` |

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
專案已附上 `compose.example.yaml`，使用固定資料目錄並掛載宿主機的 `./data`：
```yaml
services:
  gptjsbot:
    image: ghcr.io/chikenscrach/gptjsbot:latest
    container_name: gptjsbot
    restart: unless-stopped
    env_file:
      - .env
    environment:
      BOT_DATA_DIR: /app/data
    volumes:
      - ./data:/app/data
```
新部署啟動服務：
```bash
docker compose -f compose.example.yaml up -d
```

既有部署請繼續使用原 Compose 檔案及資料目錄，例如 `docker compose -f docker-compose.yml up -d`。套用範例前須確認掛載來源與 `BOT_DATA_DIR` 都仍指向原資料庫。

##### 💡 方式二：使用 Docker Run 傳統啟動
```bash
docker run -d \
  --name gptjsbot \
  --env-file .env \
  -v ./data:/app/data \
  ghcr.io/chikenscrach/gptjsbot:latest
```

> ⚠️ **注意事項：** 
> * 請務必掛載 `-v ./data:/app/data`，讓 SQLite 資料庫 (`bot.db`) 中的 Logger 設定、提醒與 Threads 訊息發送者紀錄在容器重建後仍可使用。
> * 更新時沿用原有 `./data/bot.db` 與相同掛載來源；從其他目錄執行部署時，請改成原資料目錄的絕對路徑。不要用空的新資料目錄取代既有資料。
> * 容器以 UID/GID `1001:1001` 執行。首次建立資料目錄可用 `mkdir -p data`，再以 `sudo chown 1001:1001 data` 給予寫入權限；已有資料的目錄也必須讓資料庫及 WAL 檔可讀寫。

新增右鍵指令後，在目前執行中的容器註冊應用程式指令：
```bash
docker exec gptjsbot npm run deploy
```

#### 3. 更新映像檔並重建容器（保留設定）

更新前先確認目前資料路徑與掛載。以下命令只讀取路徑，不會輸出 Token；容器名稱請換成實際名稱：
```bash
docker exec gptjsbot node -p "require('path').resolve(process.env.BOT_DATA_DIR || '/app/data')"
docker inspect gptjsbot --format '{{range .Mounts}}{{println .Type .Name .Source "->" .Destination}}{{end}}'
```

掛載目的地必須涵蓋資料目錄（預設 `/app/data`）。`bind` 要沿用相同的宿主機 `Source`；`volume` 要沿用相同的 `Name`，不要把 Docker 管理的內部路徑改成 bind mount。只掛載 `bot.db` 單檔不足以保護尚在 WAL 的寫入，應掛載整個資料目錄。

已確認持久掛載後，使用原 Compose 檔案更新，例如：
```bash
docker compose -f docker-compose.yml pull gptjsbot
docker compose -f docker-compose.yml up -d gptjsbot
```

檔名與 service 名稱請依原部署調整；使用本專案範例的新部署則指定 `-f compose.example.yaml`。重建後再次檢查資料路徑與掛載，並用 `/logger status` 確認設定。更新不需要 `down -v`，也不要刪除仍在使用的資料卷。Docker Run 或管理介面重建時，同樣必須保留原本的掛載來源。

如果更新前沒有持久掛載，先依下方「重啟後設定消失的檢查方式」保存舊容器資料，再重建。單純更換映像檔或設定 `BOT_DATA_DIR`，無法自動把舊容器內的資料移到新容器。[Docker 儲存說明](https://docs.docker.com/engine/storage/)

---

### 方案 B：傳統 Node.js 本地部署

1. **安裝依賴套件**
   ```bash
   npm install
   ```

2. **註冊應用程式指令（斜線與訊息右鍵）**
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
├── commands/               # 斜線與訊息右鍵指令模組 (自動讀取)
│   ├── chat.js             # AI 聊天 (/chat，支援自訂模型選單)
│   ├── reminder.js         # 設定提醒 (/reminder)
│   ├── quest.js            # Discord 任務查詢 (/quest，列表／搜尋／統計)
│   ├── logger.js           # 伺服器事件日誌設定 (/logger)
│   ├── url.js              # 網址轉換開關與規則查詢 (/url)
│   ├── delete-message.js   # 訊息右鍵：刪除網址轉換訊息
│   └── ...                 # ping, avatar, info, status, help
├── core/                   # 核心調度邏輯
│   ├── chat.js             # Groq API 封裝與可配置模型邏輯
│   ├── client-options.js   # Discord Gateway intents 與 partials 設定
│   ├── db.js               # SQLite 資料庫初始化（含 logger_settings 資料表）
│   ├── deploy-commands.js  # Discord 斜線指令部署腳本
│   ├── logger.js           # Logger 共用模組（設定讀寫、Embed 建構）
│   ├── converted-messages.js # 網址轉換訊息的 Discord 發送者紀錄
│   ├── url-config.js       # 載入與驗證外部網址規則
│   ├── url-settings.js     # 各伺服器的網址開關與預設值
│   ├── command-interactions.js # Slash、右鍵與動態自動完成分派
│   └── scheduler.js        # 定時提醒任務排程器
├── events/
│   ├── guildMemberAdd.js   # 監聽成員加入事件（Logger）
│   ├── guildMemberRemove.js # 監聽成員離開事件（Logger）
│   ├── messageCreate.js    # 監聽訊息（負責網址偵測與轉換）
│   ├── presenceUpdate.js   # 監聽成員上線狀態變更（Logger）
│   ├── messageDelete.js    # 監聽訊息刪除事件（Logger）
│   ├── messageBulkDelete.js # 監聽批次訊息刪除事件（Logger）
│   ├── messageUpdate.js    # 監聽訊息編輯事件（Logger）
│   └── voiceStateUpdate.js # 監聽語音頻道移動事件（Logger）
├── handlers/               # 網址解析與格式修復模組 (Modular Handlers)
│   ├── facebook.js         # 處理 Facebook 貼文、多圖與小幫手
│   ├── twitter.js          # 轉換 Twitter / X 連結至 Fixvx
│   ├── threads.js          # 清理 Threads 網址與追蹤參數
│   ├── simple.js           # 依設定檔執行簡單網域轉換
│   ├── youtube.js          # YouTube 轉簡短網址
│   └── index.js            # 集中匯出網址處理器
├── data/
│   └── bot.db              # SQLite 本地資料庫 (自動產生)
├── Dockerfile              # 多階段、高安全性的 Docker 映像檔建置規則
├── settings.example.json   # 內附網址規則預設值與可複製的範例
├── settings.json           # 個人網址設定（選用，不納入 Git／Docker 映像）
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
*   `/url`：管理目前伺服器的網址轉換開關，並查看各平台的狀態與目標網域。

### 📋 伺服器事件日誌 (`/logger`)

> ⚠️ **使用前須知**：成員加入／離開日誌需在 Developer Portal 開啟 **Server Members Intent**，設定 `LOGGER_MEMBERS_ENABLED=true`；presence 日誌需同時開啟 **Presence Intent**、**Server Members Intent**，設定 `LOGGER_PRESENCE_ENABLED=true`。變更環境旗標後必須重啟 Bot。語音與訊息日誌不依賴這兩個旗標。

環境旗標只讓部署具備接收對應事件的能力，不會替任何伺服器開啟日誌。成員加入、成員離開與語音頻道事件的個別開關預設皆為關閉，管理員必須透過 `/logger toggle` 明確啟用。

此功能為**選擇性啟用**，預設關閉。啟用後，機器人會在指定的頻道中即時推送伺服器內的事件訊息（Embed 格式，依事件類型以顏色區分）：

| 事件類型 | 顏色 | 記錄內容 |
| :--- | :---: | :--- |
| 🟢 上線狀態變更 | 綠 / 紅 / 黃 | 成員上線、閒置、勿擾、離線切換，附時間戳記與當前活動 |
| 👋 成員加入 | 綠 | 加入的成員、帳號與加入時間等可取得的 metadata |
| 🚪 成員離開／遭移除 | 紅 | 成員與發生時間等可取得的 metadata；不推測是自行離開、踢除或封鎖 |
| 🔊 語音頻道移動 | 藍 | 成員加入、離開或由一個語音／舞台頻道移至另一個頻道 |
| 🗑️ 訊息刪除／批次刪除 | 紅 | 作者、所在頻道與可取得的訊息內容／附件；未快取時內容標示為未知 |
| ✏️ 訊息編輯 | 黃 | 作者、頻道、訊息連結與修改後內容；只有已快取舊訊息才能顯示可靠的「修改前」內容 |

#### 子指令一覽（需具備「管理伺服器」權限）

*   `/logger enable`：啟用日誌功能（須先設定頻道）。
*   `/logger disable`：停用日誌功能。
*   `/logger set-channel <channel>`：指定接收日誌訊息的文字或公告頻道。
*   `/logger toggle <event>`：開關個別事件類型（`log_presence` / `log_member_join` / `log_member_leave` / `log_voice` / `log_message_delete` / `log_message_update`）。
*   `/logger exclude-channel <channel>`：將指定頻道、討論串或分類加入／移出「不記錄」清單；排除父頻道或分類時也會排除其下的討論串。語音移動的來源或目的任一端被排除時，整筆事件都不會記錄。
*   `/logger exclude-bots`：切換是否記錄機器人產生的事件（預設排除，避免自我觸發循環）。
*   `/logger status`：檢視目前設定（含頻道、各事件狀態、排除清單）。

#### 快速啟用流程

1.  依需要啟用部署層旗標：成員加入／離開使用 `LOGGER_MEMBERS_ENABLED=true` 與 **Server Members Intent**；presence 使用 `LOGGER_PRESENCE_ENABLED=true` 與 **Presence Intent**、**Server Members Intent**。不需要這些功能可保持預設關閉。
2.  在伺服器中建立一個專門用來接收日誌的頻道（建議設為管理員可見）。
3.  執行 `/logger set-channel` 並選擇該頻道。
4.  視需求執行 `/logger toggle` 調整要監測的事件類型。
5.  執行 `/logger enable` 啟用。完成後可隨時用 `/logger status` 檢視設定。

#### 設計考量

*   **避免循環**：預設排除所有機器人事件，避免機器人發送日誌訊息時又被自己記錄。
*   **長訊息保護**：訊息內容超過 1000 字元會自動截斷並附「…(已截斷)」後綴，避免 Embed 欄位超過 Discord 1024 字元上限。
*   **partial 訊息處理**：Bot 會 fetch 更新後的訊息，但 Discord API 無法取回已刪除內容，也無法藉由 fetch 還原編輯前版本。因此只有事件發生前已在 Discord.js 快取中的訊息能可靠顯示原文；未快取事件仍會記錄 Message ID、頻道等可取得的 metadata，未知內容會明確標示，不會偽稱完整。
*   **資料最小化**：Logger 不會為了補足未快取事件而另建無界限的聊天內容快照資料庫。
*   **成員移除語意**：Discord 的成員移除事件同時涵蓋自行離開、踢除與封鎖，Logger 不會在沒有可靠證據時標示原因或操作者。
*   **語音隱私**：語音日誌只記錄成員加入、離開或移動頻道的狀態，不會擷取、錄製或分析任何語音內容，也不記錄靜音、耳機或串流切換。若來源或目的頻道在排除清單中，整筆移動事件都會被抑制，避免從另一端洩漏受排除頻道的活動。
*   **存取與保留**：成員與語音活動屬於敏感 metadata，建議將日誌頻道設為僅管理員可見，並依伺服器的隱私政策定期清理；Logger 本身不會另建成員或語音歷程資料庫，日誌保留時間由 Discord 頻道訊息決定。
*   **每伺服器獨立設定**：設定以伺服器為單位儲存於 SQLite，各伺服器互不影響。

#### 重啟後設定消失的檢查方式

Logger 設定會立即寫入 SQLite，啟動時不會重設。若 `/logger status` 在重啟後回到預設，請確認 `BOT_DATA_DIR` 與容器掛載是否仍指向原有的 `bot.db`。Docker 重建必須保留原本的宿主機資料目錄；本地或 PM2 部署建議設定絕對 `BOT_DATA_DIR`，避免相對路徑因工作目錄不同而開啟另一份資料庫。若舊資料只留在尚未刪除的容器內，應先停止該容器並保存整個 `/app/data`（含可能存在的 `bot.db-wal`），再重建及沿用該資料目錄。

若舊容器仍存在，可將資料複製到全新的復原目錄。下方 `gptjsbot-old` 請替換成保有原設定的舊容器名稱；若先前自訂 `BOT_DATA_DIR`，也要替換 `/app/data`。先停止所有會寫入這份資料庫的程序，再複製：
```bash
(
  set -eu
  docker stop gptjsbot-old
  recovery_dir=$(mktemp -d "$PWD/gptjsbot-data-recovery.XXXXXX")
  docker cp gptjsbot-old:/app/data/. "$recovery_dir/"
  sudo chown -R 1001:1001 "$recovery_dir"
  printf '復原資料目錄：%s\n' "$recovery_dir"
)
```

將輸出的絕對路徑掛載到新容器的 `/app/data`，並設定 `BOT_DATA_DIR=/app/data`。確認 `/logger status` 已恢復後，再處理舊容器與備份；不要讓新舊 Bot 同時使用同一份資料庫。`docker cp` 可讀取已停止的容器，整個目錄複製能一併保留 SQLite WAL 檔。[Docker 複製說明](https://docs.docker.com/reference/cli/docker/container/cp/)

若舊容器已移除，仍可檢查原本的 bind mount、具名或匿名 volume 及備份是否存在。只有在舊容器資料、持久儲存與備份都不存在時，才需重新設定 Logger；新版本無法重建已遺失的設定。

### 🗑️ 刪除網址轉換訊息

對機器人產生的網址轉換訊息按右鍵 → **應用程式 → 刪除訊息**。適用於所有支援的平台，包括 Threads、Facebook、X／Twitter、Instagram、TikTok、Pixiv、Bluesky、Bilibili 與 YouTube；轉換連結、媒體預覽、額外媒體及解析提示都可使用。原本貼上網址的 Discord 成員，或在該頻道具備「管理訊息」權限的 mod／管理員可使用；結果只有操作本人看得到。

每次只刪除選中的機器人訊息。若媒體分成多則，請分別操作；原本的使用者訊息會保留。同一則機器人回覆若包含多個平台或網址，刪除會移除該整則回覆。

更新後所有網址轉換訊息的發送者都會保存於 SQLite，因此重啟後或原訊息被刪除後仍能辨識本人。既有 Threads 紀錄會保留；更舊且沒有紀錄的 Threads 主回覆可透過仍存在的原訊息確認本人。更新前未記錄的其他平台訊息與舊版獨立媒體批次，須由 mod 使用 Discord 原生刪除功能處理。

更新後須執行 `npm run deploy` 並重啟 Bot，右鍵選單才會從「刪除 Threads 訊息」更新為「刪除訊息」。

### 🔗 自動網址轉換對照表 (Embed Fixer)
當一般使用者發送以下平台網址時，機器人會依啟用狀態產生替代連結或媒體預覽。下表為內附預設值；簡單網域轉換可透過設定檔調整。成功產生轉換內容時會隱藏原訊息預覽；若同一則訊息包含停用平台，則保留整則原訊息的預覽，因為 Discord 無法只隱藏其中一個網址的預覽。

| 原始網址 | 轉換後網址 (修復預覽) | 備註說明 |
| :--- | :--- | :--- |
| `x.com` / `twitter.com` | `fixvx.com` | 完美還原 X 影片與多圖預覽 |
| `pixiv.net` | `phixiv.net` | 解決 Pixiv 圖片無法直接在 Discord 顯示的問題 |
| `tiktok.com` | `tnktok.com` | 支援 TikTok 影片在 Discord 內直接播放 |
| `instagram.com` | `kkinstagram.com` | 修正 IG 貼文、Reels 影片無法預覽的問題 |
| `bsky.app` | `fxbsky.app` | 修正 Bluesky 預覽 |
| `bilibili.com` / `b23.tv` | `vxbilibili.com` / `vxb23.tv` | 修正 B 站影片預覽 |
| `threads.net` / `threads.com` | Bot 直接產生媒體預覽 | 原文與引用連結統一使用 `https://www.threads.com/...`，移除追蹤參數 |
| `facebook.com` / `fb.watch` | `facebed.com` | 自動解析真實貼文 ID，排除登入牆限制 |
| `youtube.com` | `youtu.be` | 自動標準化為 YouTube 短網址 |

### ⚙️ 自訂簡單網址規則 (`settings.json`)

未建立設定檔時，Bot 沿用 `settings.example.json` 的預設行為。首次建立個人設定可複製範例：

```bash
test -e settings.json || cp settings.example.json settings.json
```

也可以只建立以下內容，同時更換 Instagram 網域並新增一條自訂規則。`source.example` 和 `preview.example` 是示意網域，請換成實際服務：

```json
{
  "urlConversion": {
    "rules": {
      "instagram": {
        "targetHost": "oginstagram.com"
      },
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

`https://source.example/item?id=123#part` 會轉成 `https://preview.example/item?id=123#part`。轉換只更換網域，保留協定、路徑及片段；目標服務仍須支援原本的網址格式。需要改寫路徑、抓取網頁或解析 API 的平台應使用專用處理器。

| 設定 | 說明 |
| :--- | :--- |
| 規則名稱（例如 `instagram`、`custom`） | 固定 ID，供 `/url toggle` 與資料庫識別。以小寫字母開頭，限 32 字元的小寫字母、數字、`_`、`-`；更換目標網域時保留 ID，即可沿用開關設定。 |
| `enabled` | 該規則的預設開關。使用 JSON 布林值 `true`／`false`，不要加引號。 |
| `hosts` | 來源網域陣列。忽略大小寫、前綴 `www.` 與結尾的 `.`；其他子網域須明確列出。 |
| `targetHost` | 目標網域，不包含 `https://`、路徑、連接埠或參數。 |
| `stripQuery` | `true` 移除 `?` 後的查詢參數，`false` 保留。原有六條簡單規則維持 `true`；新規則預設 `false`，以免刪除必要的 `?id=...`。 |

設定按規則 ID 合併：省略的規則與欄位沿用內附預設，新規則必須提供 `hosts` 和 `targetHost`。因此從個人檔案刪除內建規則會恢復預設，若要改變預設開關請設定 `enabled: false`；已經在 Discord 覆寫的伺服器仍以自己的開關為準。刪除自訂規則後，它會從轉換與選單中移除。

`urlConversion.enabled` 可設定總開關的預設值；專用處理器只開放 `urlConversion.handlers.<名稱>.enabled`，名稱為 `twitter`、`facebook`、`threads`、`youtube`，解析程式及目標網址仍保留於各處理器中。所有 `enabled` 都是預設值，伺服器管理員可透過 `/url` 覆寫；它們不是禁止管理員重新啟用的全域鎖定。

Bot 在啟動時載入設定。修改網域、新增規則或改變預設值後重啟即可，不需重新註冊 Discord 指令。重複的來源網域、與專用處理器衝突的 ID／網域、未知欄位或錯誤格式都會中止啟動並指出問題；停用規則也會驗證。明確設定 `SETTINGS_FILE` 時，找不到該檔案會報錯，避免意外啟用預設規則。

### 🔄 伺服器網址開關 (`/url`)

首次安裝此功能時，執行 `npm run deploy` 並重啟 Bot；Docker 部署可用 `docker exec gptjsbot npm run deploy`。`/url` 僅供具備「管理伺服器」權限的成員在伺服器中使用，操作結果僅本人可見。

| 指令 | 行為 |
| :--- | :--- |
| `/url enable` | 開啟目前伺服器的總開關，保留個別平台設定。 |
| `/url disable` | 暫停目前伺服器的所有網址轉換，保留個別平台設定。 |
| `/url toggle target:instagram` | 切換某平台或自訂規則的開關；專用處理器也能指定，例如 `target:threads`。 |
| `/url reset target:instagram` | 清除該平台的伺服器覆寫，重新跟隨設定檔預設值。 |
| `/url status [page]` | 分頁查看總開關、個別開關、設定來源與簡單規則的目標網域。 |

`target` 會依目前載入的規則提供動態建議；新規則不需要修改指令選單或再次 deploy。預設簡單規則名稱為 `pixiv`、`tiktok`、`instagram`、`bluesky`、`bilibili`、`b23`。

開關立即寫入既有 `bot.db` 的 `url_conversion_settings`／`url_conversion_overrides`，各伺服器獨立，重啟與更新時沿用同一資料目錄即可保留。Discord 操作不會修改 JSON。實際轉換需要「伺服器總開關」和「該規則開關」都開啟；個別開關優先順序為伺服器覆寫 → 設定檔預設。總開關關閉時，toggle 仍可調整個別設定，但不會開始轉換。既有私訊轉換沿用設定檔預設，不提供私訊開關指令。

### 🐳 Docker 掛載個人網址設定

`compose.example.yaml` 已附上可取消註解的掛載範例。先建立宿主機的 `settings.json`，再將下列項目加入原本的 `volumes`，並保留既有資料目錄掛載：

```yaml
volumes:
  - ./data:/app/data
  - type: bind
    source: ./settings.json
    target: /app/settings.json
    read_only: true
    bind:
      create_host_path: false
```

使用 Docker Run 時，加入 `--mount type=bind,src="$(pwd)/settings.json",dst=/app/settings.json,readonly`。容器需要能讀取這個檔案。`SETTINGS_FILE` 若使用自訂位置，必須填容器內的路徑，並與掛載目的地一致。

首次新增掛載要以原部署設定重建容器，例如 `docker compose -f compose.example.yaml up -d gptjsbot`；後續只修改規則內容，可用 `docker compose -f compose.example.yaml restart gptjsbot` 或 `docker restart gptjsbot` 重新載入。既有部署請換成原 Compose 檔名及 service 名稱。個人 `settings.json` 已排除於 Git 和 Docker 建置內容，規則由宿主機掛載，開關則保存於原資料庫。

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
*   如果是**簡單的網域替換**：在 `settings.json` 的 `urlConversion.rules` 新增一個固定 ID，設定 `hosts` 和 `targetHost`，重啟 Bot 即可。
*   如果是**複雜的 API 解析**：在 `handlers/` 下建立具有 `name`、`match`、`resolve` 的新處理器，啟動時會自動載入並加入 `/url` 選單。處理器名稱不可與現有規則重複。

---

## 📄 授權條款

本專案採用 [MIT License](LICENSE) 進行授權。歡迎自由 Fork、修改與分享！
