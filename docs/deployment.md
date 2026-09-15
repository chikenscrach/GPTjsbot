# Deployment — 部署與更新

## Docker Compose（推薦）

專案提供 `compose.example.yaml`，使用 GHCR 映像並把 SQLite 資料掛載到宿主機 `./data`。

```bash
docker compose -f compose.example.yaml up -d
```

首次部署或應用程式指令有變更時：

```bash
docker exec gptjsbot npm run deploy
```

查看狀態：

```bash
docker ps
docker logs -f gptjsbot
```

## Docker Run

```bash
docker run -d \
  --name gptjsbot \
  --restart unless-stopped \
  --env-file .env \
  -v "$(pwd)/data:/app/data" \
  ghcr.io/chikenscrach/gptjsbot:latest
```

## Node.js 本地部署

需求：Node.js 22 或更新版本。

```bash
npm install
npm run deploy
npm start
```

## SQLite 資料持久化

`bot.db` 會保存 Logger 設定、提醒、網址開關與其他狀態。Docker 部署應掛載**整個資料目錄**，不要只掛 `bot.db` 單一檔案，因為 SQLite 可能同時使用 WAL 檔。

Compose 範例：

```yaml
volumes:
  - ./data:/app/data
```

容器使用 `/app/data` 時，確保目錄可由容器使用者讀寫。現有部署更新時要沿用原資料來源，不要換成新的空目錄。

## 自訂 `settings.json`

先建立：

```bash
cp settings.example.json settings.json
```

Compose 中取消以下掛載範例的註解：

```yaml
- type: bind
  source: ./settings.json
  target: /app/settings.json
  read_only: true
  bind:
    create_host_path: false
```

修改設定後重啟 Bot 即可載入，不需要重新 deploy Discord 指令：

```bash
docker restart gptjsbot
```

## 更新 GHCR 映像

先確認目前 volume／bind mount：

```bash
docker inspect gptjsbot --format '{{range .Mounts}}{{println .Type .Name .Source "->" .Destination}}{{end}}'
```

確認 `/app/data` 仍指向舊資料後，再更新：

```bash
docker compose -f docker-compose.yml pull gptjsbot
docker compose -f docker-compose.yml up -d gptjsbot
```

如果你使用的是專案範例，將檔名換成 `compose.example.yaml`。

> 不需要 `down -v`。`-v` 會刪除 volume，可能造成資料遺失。

## 從舊容器救回資料

若舊容器仍存在、但之前沒有正確掛載資料，先停止會寫入資料庫的程序，再把整個 `/app/data` 複製出來：

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

之後將該目錄掛載到新容器 `/app/data`，確認 `/logger status` 等資料正確後再處理舊容器。

更多錯誤處理請看 [Troubleshooting](troubleshooting.md)。
