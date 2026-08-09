'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const threads = require('../handlers/threads');

const INVALID_POST_URL = 'https://www.threads.com/?error=invalid_post';
const LOCK_NOTICE = '🔒 此貼文需要登入 Threads 才能檢視（私人帳號或限定內容）';
const DELETED_NOTICE = '網址錯誤或脆文已刪除';

function makeResponse({ status = 200, location = null, html = '' } = {}) {
    return {
        status,
        ok: status >= 200 && status < 300,
        headers: {
            get(name) {
                return name.toLowerCase() === 'location' ? location : null;
            },
        },
        body: {
            cancel: async () => undefined,
        },
        text: async () => html,
    };
}

async function withFetchScript(steps, callback) {
    const originalFetch = global.fetch;
    let callIndex = 0;
    global.fetch = async (url, options) => {
        const step = steps[callIndex++];
        assert.ok(step, `unexpected fetch: ${url}`);
        assert.equal(String(url), step.url);
        assert.equal(options.redirect, 'manual');
        return makeResponse(step);
    };

    try {
        const result = await callback();
        assert.equal(callIndex, steps.length, 'not all expected fetches were made');
        return result;
    } finally {
        global.fetch = originalFetch;
    }
}

test('resolved share link keeps the login notice when a public profile leads to invalid_post', async () => {
    const shareUrl = 'https://www.threads.com/share/BAY2F1Uxf5/';
    const redirectedPostUrl = 'https://www.threads.com/@kulomi.i/post/DbyOIPhiRB0?xmt=AQG_test';
    const result = await withFetchScript([
        { url: shareUrl, status: 302, location: redirectedPostUrl },
        { url: redirectedPostUrl, status: 302, location: '/?error=invalid_post' },
        { url: INVALID_POST_URL },
        { url: 'https://www.threads.com/@kulomi.i' },
    ], () => threads.resolve(shareUrl));

    assert.equal(result.type, 'notice');
    assert.equal(result.message, LOCK_NOTICE);
    assert.equal(
        result.components[0].components[0].url,
        'https://threads.com/@kulomi.i/post/DbyOIPhiRB0',
    );
});

test('share link that never resolves to a canonical post keeps the deleted notice', async () => {
    const shareUrl = 'https://www.threads.com/share/missing/';
    const result = await withFetchScript([
        { url: shareUrl, status: 302, location: '/?error=invalid_post' },
        { url: INVALID_POST_URL },
    ], () => threads.resolve(shareUrl));

    assert.deepEqual(result, { type: 'notice', message: DELETED_NOTICE });
});

test('direct canonical link with a public profile keeps the deleted notice', async () => {
    const inputUrl = 'https://threads.com/@kulomi.i/post/DbyOIPhiRB0';
    const fetchedPostUrl = 'https://www.threads.com/@kulomi.i/post/DbyOIPhiRB0';
    const result = await withFetchScript([
        { url: fetchedPostUrl, status: 302, location: '/?error=invalid_post' },
        { url: INVALID_POST_URL },
        { url: 'https://www.threads.com/@kulomi.i' },
    ], () => threads.resolve(inputUrl));

    assert.deepEqual(result, { type: 'notice', message: DELETED_NOTICE });
});
