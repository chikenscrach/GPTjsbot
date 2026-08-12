// core/summarize.js
// 呼叫部署在 Deno Deploy 上的網頁摘要服務。
//
// 服務端負責：網址驗證（擋私有 IP）、用 Jina Reader 抓網頁、丟給 OpenRouter 總結。
// 這裡只做 HTTP 呼叫與錯誤轉譯，不重複實作任何邏輯。

// 服務端最壞情況：抓網頁 45s + 模型 90s。留一點餘裕。
// Discord 的 interaction token 有 15 分鐘有效期，這個長度綽綽有餘。
const DEFAULT_TIMEOUT_MS = 150 * 1000;

class SummarizeError extends Error {
  constructor(message, { status = null, retryable = false } = {}) {
    super(message);
    this.name = 'SummarizeError';
    this.status = status;
    this.retryable = retryable;
  }
}

function isRetryableStatus(status) {
  return status === 429 || status >= 500;
}

function isTimeoutError(error) {
  return error?.name === 'TimeoutError';
}

function normalizeHttpUrl(value) {
  if (typeof value !== 'string') return null;

  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
      ? parsed.href
      : null;
  } catch {
    return null;
  }
}

function readConfig() {
  const baseUrl = process.env.SUMMARIZE_API_URL;
  const token = process.env.SUMMARIZE_API_TOKEN;

  if (!baseUrl || !token) {
    throw new SummarizeError(
      '摘要服務尚未設定。請在 .env 填入 SUMMARIZE_API_URL 與 SUMMARIZE_API_TOKEN。',
    );
  }

  const timeoutMs = Number.parseInt(process.env.SUMMARIZE_TIMEOUT_MS ?? '', 10);
  return {
    // 允許填 https://app.deno.net 或 https://app.deno.net/api/summarize 兩種寫法
    endpoint: baseUrl.replace(/\/+$/, '').endsWith('/api/summarize')
      ? baseUrl.replace(/\/+$/, '')
      : `${baseUrl.replace(/\/+$/, '')}/api/summarize`,
    token,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS,
  };
}

/**
 * 取得網頁摘要。
 *
 * @param {string} url 要分析的網址
 * @param {string} userId Discord 使用者 ID，服務端用來分別計算額度
 * @returns {Promise<{title: string, summary: string, url: string, truncated: boolean}>}
 * @throws {SummarizeError} 設定缺失、逾時、或服務端回傳錯誤
 */
async function fetchSummary(url, userId) {
  const { endpoint, token, timeoutMs } = readConfig();

  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      // 加 dc: 前綴，避免和 Telegram 端的額度互相干擾
      body: JSON.stringify({ url, userId: `dc:${userId}` }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (isTimeoutError(error)) {
      throw new SummarizeError('摘要服務逾時，這個網頁可能太大或太慢。', { retryable: true });
    }
    throw new SummarizeError(`無法連線到摘要服務：${error.message}`, { retryable: true });
  }

  // 服務端一律回 JSON；真的解析失敗代表打到了非預期的東西（例如代理錯誤頁）
  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    const timedOut = isTimeoutError(error);
    throw new SummarizeError(
      timedOut
        ? '摘要服務逾時，這個網頁可能太大或太慢。'
        : `摘要服務回傳了非預期的內容（HTTP ${response.status}）。`,
      {
        status: response.status,
        retryable: timedOut || isRetryableStatus(response.status),
      },
    );
  }

  if (!response.ok || payload?.ok !== true) {
    const detail = typeof payload?.error === 'string' ? payload.error : `HTTP ${response.status}`;
    throw new SummarizeError(detail, {
      status: response.status,
      // 429／502 稍後重試有機會成功；400／401 重試也沒用
      retryable: isRetryableStatus(response.status),
    });
  }

  const resultUrl = normalizeHttpUrl(payload.url) ?? normalizeHttpUrl(url);
  if (!resultUrl) {
    throw new SummarizeError('摘要服務回傳了無效的網址。', { status: response.status });
  }

  return {
    title: typeof payload.title === 'string' ? payload.title : '',
    summary: typeof payload.summary === 'string' ? payload.summary : '',
    url: resultUrl,
    truncated: payload.truncated === true,
  };
}

module.exports = { fetchSummary, SummarizeError, DEFAULT_TIMEOUT_MS };
