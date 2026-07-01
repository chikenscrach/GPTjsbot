# syntax=docker/dockerfile:1.7
# ============================================================
# 階段 1：安裝依賴（slim + build tools，比完整映像更精簡）
# ============================================================
FROM node:22.23.1-bookworm-slim AS builder

RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./

RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --no-audit --no-fund && \
    find node_modules -type f \( \
      -name "*.md" -o \
      -name "*.ts" -o \
      -name "*.map" -o \
      -name "CHANGELOG*" -o \
      -name "HISTORY*" -o \
      -iname "readme*" \
    \) -delete && \
    find node_modules -type d \( \
      -name "__tests__" -o \
      -name "test" -o \
      -name "tests" -o \
      -name "__test__" -o \
      -name "docs" -o \
      -name ".github" \
    \) -prune -exec rm -rf {} +

# ============================================================
# 階段 2：最終運行映像
# ============================================================
FROM node:22.23.1-bookworm-slim AS runner

ENV NODE_ENV=production \
    NODE_NO_WARNINGS=1

WORKDIR /app

RUN apt-get update && \
    apt-get install -y --no-install-recommends tini && \
    rm -rf /var/lib/apt/lists/* && \
    groupadd --gid 1001 appuser && \
    useradd --uid 1001 --gid appuser --shell /usr/sbin/nologin --create-home appuser && \
    mkdir -p /app/data && chown appuser:appuser /app/data

COPY --chown=appuser:appuser --from=builder /app/node_modules ./node_modules
COPY --chown=appuser:appuser . .

USER appuser

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "index.js"]