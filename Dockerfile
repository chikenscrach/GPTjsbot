# 使用官方 Node LTS 映像作為基底
FROM node:20

# 設定工作目錄
WORKDIR /app

# 複製 package.json 和 lock 檔案
COPY package*.json ./

# 安裝依賴
RUN npm install

# 複製其餘所有檔案
COPY . .

# 啟動 bot
CMD ["node", "index.js"]