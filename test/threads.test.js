'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const threads = require('../handlers/threads');

const INVALID_POST_URL = 'https://www.threads.com/?error=invalid_post';
const LOCK_NOTICE = '🔒 此貼文需要登入 Threads 才能檢視（私人帳號或限定內容）';
const DELETED_NOTICE = '網址錯誤或脆文已刪除';

function makeResponse({ status = 200, location = null, html = '', bodyChunks = null } = {}) {
    const chunks = bodyChunks && bodyChunks.map(chunk => Buffer.from(chunk));
    return {
        status,
        ok: status >= 200 && status < 300,
        headers: {
            get(name) {
                const key = name.toLowerCase();
                if (key === 'location') return location;
                if (key === 'content-length' && chunks) {
                    return String(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
                }
                return null;
            },
        },
        body: {
            cancel: async () => undefined,
            async *[Symbol.asyncIterator]() {
                for (const chunk of chunks || []) yield chunk;
            },
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
        if (step.manual === false) assert.equal(options.redirect, undefined);
        else assert.equal(options.redirect, 'manual');
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

function imageMedia(url, width = 1200) {
    return {
        image_versions2: {
            candidates: [{ url, width }],
        },
    };
}

function postHtml({
    username = 'target.user',
    displayName = 'Target User',
    ogDescription = 'OG target description',
    ogImage = null,
    pageUrl = null,
    chunks = [],
} = {}) {
    const encodedPageUrl = pageUrl && pageUrl.replace('@', '&#64;');
    const metadata = [
        `<meta property="og:title" content="${displayName} (@${username}) on Threads">`,
        ogDescription ? `<meta property="og:description" content="${ogDescription}">` : '',
        ogImage ? `<meta property="og:image" content="${ogImage}">` : '',
        encodedPageUrl ? `<meta property="og:url" content="${encodedPageUrl}">` : '',
        encodedPageUrl ? `<link rel="canonical" href="${encodedPageUrl}">` : '',
    ];
    const scripts = chunks.map(chunk => {
        const json = typeof chunk === 'string' ? chunk : JSON.stringify(chunk);
        return `<script type="application/json" data-sjs>${json}</script>`;
    });
    return metadata.concat(scripts).join('');
}

function assertEmbedResult(result, {
    canonicalUrl,
    description,
    imageUrl = null,
    fileNames = [],
}) {
    assert.equal(result.type, 'embed');
    assert.equal(result.embed.description, description);
    assert.equal(result.embed.url, canonicalUrl);
    if (imageUrl) assert.equal(result.embed.image.url, imageUrl);
    else assert.equal(result.embed.image, undefined);
    assert.equal(result.files.length, fileNames.length);
    assert.deepEqual(result.files.map(file => file.name), fileNames);
    assert.equal(result.originalUrl, canonicalUrl);

    const originalButton = result.components[0].components[0];
    assert.equal(originalButton.label, '開啟原文');
    assert.equal(originalButton.style, 5);
    assert.equal(originalButton.url, canonicalUrl);
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

test('successful share redirect returns the canonical post and link button', async () => {
    const shareUrl = 'https://www.threads.com/share/share-ok/';
    const redirectedUrl = 'https://www.threads.com/@target.user/post/ShareTarget?xmt=AQG_tracking';
    const canonicalUrl = 'https://www.threads.com/@target.user/post/ShareTarget';
    const html = postHtml({
        pageUrl: canonicalUrl,
        chunks: [{
            code: 'ShareTarget',
            caption: { text: 'Resolved share caption' },
        }],
    });

    const result = await withFetchScript([
        { url: shareUrl, status: 302, location: redirectedUrl },
        { url: redirectedUrl, html },
    ], () => threads.resolve(shareUrl));

    assertEmbedResult(result, {
        canonicalUrl,
        description: 'Resolved share caption',
    });
});

test('target shortcode absence never leaks escaped media or caption from another post', async () => {
    const canonicalUrl = 'https://www.threads.com/@target.user/post/MissingTarget';
    const escapedWrongPost = '{"code":"OtherCode","caption":{"text":"Wrong recommended caption","extra":true},'
        + '"image_versions2":{"candidates":[{"url":"https:\\/\\/cdn.example.test\\/wrong.jpg","width":1200}]}}';
    const html = postHtml({
        ogDescription: 'Verified OG target description',
        pageUrl: canonicalUrl,
        chunks: [escapedWrongPost],
    });
    assert.equal(
        JSON.parse(escapedWrongPost).image_versions2.candidates[0].url,
        'https://cdn.example.test/wrong.jpg',
    );
    assert.ok(html.includes('https:\\/\\/cdn.example.test\\/wrong.jpg'));

    const result = await withFetchScript([
        { url: canonicalUrl, html },
    ], () => threads.resolve(canonicalUrl));

    assertEmbedResult(result, {
        canonicalUrl,
        description: 'Verified OG target description',
    });
    assert.equal(result.embeds.length, 1);
    assert.equal(JSON.stringify(result).includes('wrong.jpg'), false);
});

test('same SJS chunk keeps unrelated caption and media outside the target post', async () => {
    const canonicalUrl = 'https://www.threads.com/@target.user/post/SiblingTarget';
    const html = postHtml({
        ogDescription: 'Verified sibling target OG description',
        pageUrl: canonicalUrl,
        chunks: [{
            route: {
                feed: [
                    {
                        code: 'OtherSibling',
                        caption: { text: 'Wrong sibling caption', extra: true },
                        ...imageMedia('https://cdn.example.test/wrong-sibling.jpg'),
                    },
                    {
                        code: 'SiblingTarget',
                    },
                ],
            },
        }],
    });

    const result = await withFetchScript([
        { url: canonicalUrl, html },
    ], () => threads.resolve(canonicalUrl));

    assertEmbedResult(result, {
        canonicalUrl,
        description: 'Verified sibling target OG description',
    });
    assert.equal(result.embeds.length, 1);
    assert.equal(JSON.stringify(result).includes('wrong-sibling.jpg'), false);
});

test('nested target quoted by an unrelated outer post is selected on its own', async () => {
    const canonicalUrl = 'https://www.threads.com/@target.user/post/NestedTarget';
    const html = postHtml({
        pageUrl: canonicalUrl,
        chunks: [{
            code: 'UnrelatedOuter',
            caption: { text: 'Wrong outer caption' },
            ...imageMedia('https://cdn.example.test/wrong-outer.jpg'),
            text_post_app_info: {
                share_info: {
                    quoted_attachment_post: {
                        code: 'NestedTarget',
                        caption: { text: 'Nested target caption' },
                    },
                },
            },
        }],
    });

    const result = await withFetchScript([
        { url: canonicalUrl, html },
    ], () => threads.resolve(canonicalUrl));

    assertEmbedResult(result, {
        canonicalUrl,
        description: 'Nested target caption',
    });
    assert.equal(result.embeds.length, 1);
    assert.equal(result.embed.fields, undefined);
    assert.equal(JSON.stringify(result).includes('wrong-outer.jpg'), false);
});

test('valid JSON whitespace around code still identifies the target post', async () => {
    const canonicalUrl = 'https://www.threads.com/@target.user/post/WhitespaceTarget';
    const targetImage = 'https://cdn.example.test/whitespace-target.jpg';
    const whitespaceJson = JSON.stringify({
        code: 'WhitespaceTarget',
        caption: { text: 'Whitespace target caption' },
        ...imageMedia(targetImage),
    }, null, 2).replace(
        '"code": "WhitespaceTarget"',
        '"code" \n : \t "WhitespaceTarget"',
    );
    assert.equal(JSON.parse(whitespaceJson).code, 'WhitespaceTarget');
    const html = postHtml({
        ogDescription: 'Wrong OG fallback',
        pageUrl: canonicalUrl,
        chunks: [whitespaceJson],
    });

    const result = await withFetchScript([
        { url: canonicalUrl, html },
    ], () => threads.resolve(canonicalUrl));

    assertEmbedResult(result, {
        canonicalUrl,
        description: 'Whitespace target caption',
        imageUrl: targetImage,
    });
});

test('compatible exact duplicates use the richest media representation', async () => {
    const canonicalUrl = 'https://www.threads.com/@target.user/post/RichDuplicate';
    const firstImage = 'https://cdn.example.test/rich-first.jpg';
    const secondImage = 'https://cdn.example.test/rich-second.jpg';
    const identity = {
        id: 'shared-post-id',
        pk: 'shared-post-pk',
        code: 'RichDuplicate',
        user: { username: 'target.user' },
    };
    const html = postHtml({
        pageUrl: canonicalUrl,
        chunks: [
            {
                ...identity,
                caption: { text: 'Caption from compatible duplicate' },
            },
            {
                ...identity,
                carousel_media: [imageMedia(firstImage), imageMedia(secondImage)],
            },
        ],
    });

    const result = await withFetchScript([
        { url: canonicalUrl, html },
    ], () => threads.resolve(canonicalUrl));

    assertEmbedResult(result, {
        canonicalUrl,
        description: 'Caption from compatible duplicate',
        imageUrl: firstImage,
    });
    assert.equal(result.embeds.length, 2);
    assert.equal(result.embeds[1].image.url, secondImage);
});

test('equal-length duplicate media prefers video over an image-only cover', async () => {
    const canonicalUrl = 'https://www.threads.com/@target.user/post/MediaTieTarget';
    const imageOnly = 'https://cdn.example.test/image-only-copy.jpg';
    const videoUrl = 'https://cdn.example.test/richer-video.mp4';
    const videoCover = 'https://cdn.example.test/richer-video-cover.jpg';
    const identity = {
        id: 'media-tie-id',
        pk: 'media-tie-pk',
        code: 'MediaTieTarget',
        user: { username: 'target.user' },
    };
    const html = postHtml({
        pageUrl: canonicalUrl,
        chunks: [
            {
                ...identity,
                caption: { text: 'Media tie target caption' },
                ...imageMedia(imageOnly),
            },
            {
                ...identity,
                image_versions2: { candidates: [{ url: videoCover, width: 1200 }] },
                video_versions: [{ url: videoUrl, width: 1200 }],
            },
        ],
    });

    const result = await withFetchScript([
        { url: canonicalUrl, html },
        { url: videoUrl, manual: false, bodyChunks: ['fake-video'] },
    ], () => threads.resolve(canonicalUrl));

    assertEmbedResult(result, {
        canonicalUrl,
        description: 'Media tie target caption',
        fileNames: ['MediaTieTarget_0.mp4'],
    });
    assert.equal(JSON.stringify(result).includes('image-only-copy.jpg'), false);
});

test('OG metadata without a post identity URL fails closed', async () => {
    const canonicalUrl = 'https://www.threads.com/@target.user/post/NoMetadataIdentity';
    const html = postHtml({
        ogDescription: 'Unverified same-author OG description',
        ogImage: 'https://cdn.example.test/unverified-og-image.jpg',
        chunks: [{
            code: 'OtherPost',
            caption: { text: 'Unrelated SJS caption' },
            ...imageMedia('https://cdn.example.test/unrelated-sjs-image.jpg'),
        }],
    });

    const result = await withFetchScript([
        { url: canonicalUrl, html },
    ], () => threads.resolve(canonicalUrl));

    assertEmbedResult(result, {
        canonicalUrl,
        description: undefined,
    });
    assert.equal(result.embed.thumbnail, undefined);
    assert.equal(JSON.stringify(result).includes('Unverified same-author'), false);
    assert.equal(JSON.stringify(result).includes('unrelated-sjs-image.jpg'), false);
});

test('ordinary target image post keeps its caption and embedded image', async () => {
    const canonicalUrl = 'https://www.threads.com/@target.user/post/ImageTarget';
    const targetImage = 'https://cdn.example.test/image-target.jpg';
    const html = postHtml({
        pageUrl: canonicalUrl,
        chunks: [{
            code: 'ImageTarget',
            caption: { text: 'Ordinary image caption' },
            ...imageMedia(targetImage),
        }],
    });

    const result = await withFetchScript([
        { url: canonicalUrl, html },
    ], () => threads.resolve(canonicalUrl));

    assertEmbedResult(result, {
        canonicalUrl,
        description: 'Ordinary image caption',
        imageUrl: targetImage,
    });
});

test('target linked-inline media stays attached to the exact outer post', async () => {
    const canonicalUrl = 'https://www.threads.com/@target.user/post/InlineTarget';
    const inlineImage = 'https://cdn.example.test/inline-target.jpg';
    const html = postHtml({
        pageUrl: canonicalUrl,
        chunks: [{
            code: 'InlineTarget',
            caption: { text: 'Linked-inline target caption' },
            text_post_app_info: {
                linked_inline_media: {
                    code: 'DifferentInlineCode',
                    ...imageMedia(inlineImage),
                },
            },
        }],
    });

    const result = await withFetchScript([
        { url: canonicalUrl, html },
    ], () => threads.resolve(canonicalUrl));

    assertEmbedResult(result, {
        canonicalUrl,
        description: 'Linked-inline target caption',
        imageUrl: inlineImage,
    });
});

test('ordinary target text post does not turn the OG image into post media', async () => {
    const canonicalUrl = 'https://www.threads.com/@target.user/post/TextTarget';
    const ogImage = 'https://cdn.example.test/profile-preview.jpg';
    const html = postHtml({
        ogImage,
        pageUrl: canonicalUrl,
        chunks: [{
            code: 'TextTarget',
            caption: { text: 'Ordinary text caption' },
        }],
    });

    const result = await withFetchScript([
        { url: canonicalUrl, html },
    ], () => threads.resolve(canonicalUrl));

    assertEmbedResult(result, {
        canonicalUrl,
        description: 'Ordinary text caption',
    });
    assert.equal(result.embed.thumbnail.url, ogImage);
});

test('ordinary target quote keeps outer text, quoted media, and both link buttons', async () => {
    const canonicalUrl = 'https://www.threads.com/@target.user/post/QuoteTarget';
    const quotedUrl = 'https://www.threads.com/@quoted.user/post/QuotedCode';
    const quotedImage = 'https://cdn.example.test/quoted-image.jpg';
    const html = postHtml({
        pageUrl: canonicalUrl,
        chunks: [{
            code: 'QuoteTarget',
            caption: { text: 'Outer quote caption' },
            text_post_app_info: {
                share_info: {
                    quoted_post: {
                        code: 'QuotedCode',
                        user: { username: 'quoted.user' },
                        caption: { text: 'Quoted post caption' },
                        ...imageMedia(quotedImage),
                    },
                },
            },
        }],
    });

    const result = await withFetchScript([
        { url: canonicalUrl, html },
    ], () => threads.resolve(canonicalUrl));

    assertEmbedResult(result, {
        canonicalUrl,
        description: 'Outer quote caption',
        imageUrl: quotedImage,
    });
    assert.deepEqual(result.embed.fields, [{
        name: '↪️ 引用 @quoted.user 的貼文',
        value: 'Quoted post caption',
    }]);

    const quotedButton = result.components[0].components[1];
    assert.equal(quotedButton.label, '開啟引用原文');
    assert.equal(quotedButton.style, 5);
    assert.equal(quotedButton.url, quotedUrl);
});

test('duplicate quote placeholder cannot hide a richer compatible quote', async () => {
    const canonicalUrl = 'https://www.threads.com/@target.user/post/QuoteDuplicate';
    const quotedUrl = 'https://www.threads.com/@quoted.user/post/QuotedRich';
    const quotedImage = 'https://cdn.example.test/quoted-rich.jpg';
    const identity = {
        id: 'quote-duplicate-id',
        pk: 'quote-duplicate-pk',
        code: 'QuoteDuplicate',
        user: { username: 'target.user' },
    };
    const html = postHtml({
        pageUrl: canonicalUrl,
        chunks: [
            {
                ...identity,
                caption: { text: 'Outer duplicate quote caption' },
                text_post_app_info: {
                    share_info: {
                        quoted_attachment_post: { code: 'QuotedRich' },
                    },
                },
            },
            {
                ...identity,
                text_post_app_info: {
                    share_info: {
                        quoted_post: {
                            code: 'QuotedRich',
                            user: { username: 'quoted.user' },
                            caption: { text: 'Complete quoted caption' },
                            ...imageMedia(quotedImage),
                        },
                    },
                },
            },
        ],
    });

    const result = await withFetchScript([
        { url: canonicalUrl, html },
    ], () => threads.resolve(canonicalUrl));

    assertEmbedResult(result, {
        canonicalUrl,
        description: 'Outer duplicate quote caption',
        imageUrl: quotedImage,
    });
    assert.deepEqual(result.embed.fields, [{
        name: '↪️ 引用 @quoted.user 的貼文',
        value: 'Complete quoted caption',
    }]);
    assert.equal(result.components[0].components[1].url, quotedUrl);
});

test('conflicting exact shortcode duplicates fail closed without candidate post data', async () => {
    const canonicalUrl = 'https://www.threads.com/@target.user/post/DuplicateTarget';
    const html = postHtml({
        ogDescription: null,
        pageUrl: canonicalUrl,
        chunks: [
            {
                id: 'post-id-a',
                pk: 'post-pk-a',
                code: 'DuplicateTarget',
                user: { username: 'first.user' },
                caption: { text: 'Conflicting candidate A' },
                ...imageMedia('https://cdn.example.test/conflicting-a.jpg'),
            },
            {
                id: 'post-id-b',
                pk: 'post-pk-b',
                code: 'DuplicateTarget',
                user: { username: 'second.user' },
                caption: { text: 'Conflicting candidate B' },
                ...imageMedia('https://cdn.example.test/conflicting-b.jpg'),
            },
        ],
    });

    const result = await withFetchScript([
        { url: canonicalUrl, html },
    ], () => threads.resolve(canonicalUrl));

    assertEmbedResult(result, {
        canonicalUrl,
        description: undefined,
    });
    assert.equal(result.embed.thumbnail, undefined);
    assert.equal(result.embeds.length, 1);
    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes('Conflicting candidate'), false);
    assert.equal(serialized.includes('conflicting-a.jpg'), false);
    assert.equal(serialized.includes('conflicting-b.jpg'), false);
});

test('mismatched OG URL cannot supply description or image when target data is absent', async () => {
    const canonicalUrl = 'https://www.threads.com/@target.user/post/AbsentTarget';
    const unrelatedUrl = 'https://www.threads.com/@other.user/post/OtherPost';
    const html = postHtml({
        username: 'other.user',
        displayName: 'Other User',
        ogDescription: 'Wrong OG description from another post',
        ogImage: 'https://cdn.example.test/wrong-og-image.jpg',
        pageUrl: unrelatedUrl,
        chunks: [{
            code: 'OtherPost',
            caption: { text: 'Wrong SJS caption from another post' },
            ...imageMedia('https://cdn.example.test/wrong-sjs-image.jpg'),
        }],
    });

    const result = await withFetchScript([
        { url: canonicalUrl, html },
    ], () => threads.resolve(canonicalUrl));

    assertEmbedResult(result, {
        canonicalUrl,
        description: undefined,
    });
    assert.equal(result.embed.thumbnail, undefined);
    assert.equal(result.embeds.length, 1);
    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes('Wrong OG description'), false);
    assert.equal(serialized.includes('wrong-og-image.jpg'), false);
    assert.equal(serialized.includes('Wrong SJS caption'), false);
    assert.equal(serialized.includes('wrong-sjs-image.jpg'), false);
});
