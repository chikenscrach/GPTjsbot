'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { fetchSummary, SummarizeError } = require('../core/summarize');
const { EmbedBuilder } = require('discord.js');
const {
  batchEmbeds,
  buildEmbeds,
  countEmbedCharacters,
} = require('../commands/summarize');

const API_URL = 'https://example.deno.net';
const API_TOKEN = 'test-token';

function makeJsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

// 暫時替換 global.fetch 與相關環境變數，結束後還原
async function withFetch(impl, callback, env = {}) {
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };

  process.env.SUMMARIZE_API_URL = API_URL;
  process.env.SUMMARIZE_API_TOKEN = API_TOKEN;
  Object.assign(process.env, env);

  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    return impl(url, options);
  };

  try {
    return await callback(calls);
  } finally {
    global.fetch = originalFetch;
    process.env = originalEnv;
  }
}

test('成功時回傳解析後的摘要', async () => {
  await withFetch(
    () => makeJsonResponse({
      ok: true,
      title: '測試文章',
      summary: '這是摘要內容。',
      url: 'https://example.com/a',
      truncated: false,
    }),
    async (calls) => {
      const result = await fetchSummary('https://example.com/a', '123456789');

      assert.equal(result.title, '測試文章');
      assert.equal(result.summary, '這是摘要內容。');
      assert.equal(result.url, 'https://example.com/a');
      assert.equal(result.truncated, false);

      const body = JSON.parse(calls[0].options.body);
      assert.equal(body.url, 'https://example.com/a');
      // 加前綴才不會和 Telegram 端的額度互相干擾
      assert.equal(body.userId, 'dc:123456789');
      assert.equal(calls[0].options.headers.Authorization, `Bearer ${API_TOKEN}`);
    },
  );
});

test('base URL 可填根網址或完整路徑，結果相同', async () => {
  for (const base of [API_URL, `${API_URL}/`, `${API_URL}/api/summarize`]) {
    await withFetch(
      () => makeJsonResponse({ ok: true, title: '', summary: 's', url: 'u', truncated: false }),
      async (calls) => {
        await fetchSummary('https://example.com/a', '1');
        assert.equal(calls[0].url, `${API_URL}/api/summarize`);
      },
      { SUMMARIZE_API_URL: base },
    );
  }
});

test('服務端回傳有效網址時保留該網址', async () => {
  await withFetch(
    () => makeJsonResponse({
      ok: true,
      title: '',
      summary: 's',
      url: 'https://resolved.example/article',
      truncated: false,
    }),
    async () => {
      const result = await fetchSummary('https://example.com/original', '1');
      assert.equal(result.url, 'https://resolved.example/article');
    },
  );
});

test('服務端回傳無效網址時退回原始網址', async () => {
  for (const invalidUrl of [undefined, '/relative', 'ftp://example.com/a', 'javascript:alert(1)']) {
    await withFetch(
      () => makeJsonResponse({
        ok: true,
        title: '',
        summary: 's',
        url: invalidUrl,
        truncated: false,
      }),
      async () => {
        const result = await fetchSummary('https://example.com/original', '1');
        assert.equal(result.url, 'https://example.com/original');
      },
    );
  }
});

test('缺少設定時丟出 SummarizeError 且不發出請求', async () => {
  await withFetch(
    () => {
      throw new Error('不應該發出請求');
    },
    async (calls) => {
      await assert.rejects(
        () => fetchSummary('https://example.com/a', '1'),
        (err) => err instanceof SummarizeError && err.message.includes('尚未設定'),
      );
      assert.equal(calls.length, 0);
    },
    { SUMMARIZE_API_URL: '', SUMMARIZE_API_TOKEN: '' },
  );
});

test('服務端錯誤會轉譯成訊息，並標記能否重試', async () => {
  const cases = [
    { status: 400, error: '不允許存取私有或保留 IP 位址。', retryable: false },
    { status: 429, error: '這個小時的額度已用完。', retryable: true },
    { status: 502, error: '讀取網頁失敗。', retryable: true },
  ];

  for (const { status, error, retryable } of cases) {
    await withFetch(
      () => makeJsonResponse({ ok: false, error }, status),
      async () => {
        await assert.rejects(
          () => fetchSummary('https://example.com/a', '1'),
          (err) => {
            assert.ok(err instanceof SummarizeError);
            assert.equal(err.message, error);
            assert.equal(err.status, status);
            assert.equal(err.retryable, retryable);
            return true;
          },
        );
      },
    );
  }
});

test('逾時會轉成可重試的錯誤', async () => {
  await withFetch(
    () => {
      throw new DOMException('timed out', 'TimeoutError');
    },
    async () => {
      await assert.rejects(
        () => fetchSummary('https://example.com/a', '1'),
        (err) => err instanceof SummarizeError && err.retryable && err.message.includes('逾時'),
      );
    },
  );
});

test('非 JSON 回應仍依 HTTP 狀態標記能否重試', async () => {
  for (const [status, retryable] of [[400, false], [429, true], [502, true]]) {
    await withFetch(
      () => ({
        ok: false,
        status,
        json: async () => {
          throw new SyntaxError('Unexpected token <');
        },
      }),
      async () => {
        await assert.rejects(
          () => fetchSummary('https://example.com/a', '1'),
          (err) => {
            assert.ok(err instanceof SummarizeError);
            assert.equal(err.status, status);
            assert.equal(err.retryable, retryable);
            return true;
          },
        );
      },
    );
  }
});

test('讀取回應內容逾時時給出可重試的錯誤', async () => {
  await withFetch(
    () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new DOMException('timed out', 'TimeoutError');
      },
    }),
    async () => {
      await assert.rejects(
        () => fetchSummary('https://example.com/a', '1'),
        (err) => err instanceof SummarizeError && err.retryable && err.message.includes('逾時'),
      );
    },
  );
});

test('短摘要組成單一 embed，標題可點擊', () => {
  const embeds = buildEmbeds({
    title: '測試文章',
    summary: '簡短摘要。',
    url: 'https://example.com/a',
    truncated: false,
  });

  assert.equal(embeds.length, 1);
  const data = embeds[0].toJSON();
  assert.equal(data.title, '測試文章');
  assert.equal(data.url, 'https://example.com/a');
  assert.equal(data.description, '簡短摘要。\n');
  assert.equal(data.footer, undefined);
});

test('沒有標題時退回顯示網域', () => {
  const [embed] = buildEmbeds({
    title: '',
    summary: '內容',
    url: 'https://example.com/a',
    truncated: false,
  });
  assert.equal(embed.toJSON().title, 'example.com');
});

test('過長標題會被截斷到 Discord 上限內', () => {
  const [embed] = buildEmbeds({
    title: '標'.repeat(400),
    summary: '內容',
    url: 'https://example.com/a',
    truncated: false,
  });
  assert.ok(embed.toJSON().title.length <= 256);
});

test('截斷提示只出現在最後一個 embed', () => {
  const embeds = buildEmbeds({
    title: '長文',
    summary: '段落內容。\n'.repeat(1200),
    url: 'https://example.com/a',
    truncated: true,
  });

  assert.ok(embeds.length > 1, '應該被切成多個 embed');
  for (const embed of embeds) {
    assert.ok(embed.toJSON().description.length <= 4096, 'description 不可超過 Discord 上限');
  }
  assert.equal(embeds[0].toJSON().footer, undefined);
  assert.ok(embeds.at(-1).toJSON().footer.text.includes('原文過長'));
  // 只有第一個帶標題
  assert.equal(embeds[1].toJSON().title, undefined);

  const batches = batchEmbeds(embeds);
  assert.deepEqual(batches.flat(), embeds, '分批後不可遺漏或重排 embed');
  assert.ok(batches.length > 1, '超過 6000 字元時應拆成多則訊息');
  for (const batch of batches) {
    assert.ok(batch.length <= 10, '每則訊息最多 10 個 embed');
    assert.ok(
      batch.reduce((total, embed) => total + countEmbedCharacters(embed), 0) <= 6000,
      '每則訊息的 embed 合計不可超過 6000 字元',
    );
  }
});

test('embed 分批同時遵守每則最多 10 個的限制', () => {
  const embeds = Array.from(
    { length: 11 },
    () => new EmbedBuilder().setDescription('短內容'),
  );

  assert.deepEqual(batchEmbeds(embeds).map(batch => batch.length), [10, 1]);
});

test('embed 分批在 6000 字元邊界正確切分', () => {
  const first = new EmbedBuilder().setDescription('a'.repeat(3000));
  const exactLimit = new EmbedBuilder().setDescription('b'.repeat(3000));
  const overLimit = new EmbedBuilder().setDescription('c'.repeat(3001));

  assert.deepEqual(batchEmbeds([first, exactLimit]).map(batch => batch.length), [2]);
  assert.deepEqual(batchEmbeds([first, overLimit]).map(batch => batch.length), [1, 1]);
});
