'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const threads = require('../handlers/threads');

const INVALID_POST_URL = 'https://www.threads.com/?error=invalid_post';
const LOCK_NOTICE = '🔒 此貼文需要登入 Threads 才能檢視（私人帳號或限定內容）';
const DELETED_NOTICE = '網址錯誤或脆文已刪除';
const UNAVAILABLE_NOTICE = '🔒 無法取得此貼文內容，可能需要登入 Threads 才能檢視。請點「開啟原文」查看。';

function makeResponse({
    status = 200,
    location = null,
    html = '',
    bodyChunks = null,
    declaredContentLength = null,
} = {}) {
    const chunks = bodyChunks && bodyChunks.map(chunk => Buffer.from(chunk));
    return {
        status,
        ok: status >= 200 && status < 300,
        headers: {
            get(name) {
                const key = name.toLowerCase();
                if (key === 'location') return location;
                if (key === 'content-length' && declaredContentLength != null) {
                    return String(declaredContentLength);
                }
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

function assertEmbedFooter(result, text) {
    assert.equal(result.embed.footer?.text, text);
}

function assertUnavailableNotice(result, canonicalUrl) {
    assert.equal(result.type, 'notice');
    assert.equal(result.message, UNAVAILABLE_NOTICE);
    assert.equal(result.embed, undefined);
    assert.equal(result.embeds, undefined);
    assert.equal(result.files, undefined);
    assert.equal(result.additionalMessages, undefined);
    const button = result.components[0].components[0];
    assert.equal(button.label, '開啟原文');
    assert.equal(button.style, 5);
    assert.equal(button.url, canonicalUrl);
}

// Synthetic HTTP 200 responses: login-gated pages need not redirect to invalid_post.
for (const [label, page] of [
    ['empty HTML', () => ''],
    ['login page with unrelated recommendations', () => postHtml({
        username: 'other.user',
        pageUrl: 'https://www.threads.com/',
        ogDescription: 'Log in to see more from Threads',
        ogImage: 'https://cdn.example.test/login-logo.jpg',
        chunks: [{ code: 'OtherPost', caption: { text: 'Unrelated recommendation' } }],
    })],
    ['author-only metadata', canonicalUrl => postHtml({
        username: 'restricted.user',
        pageUrl: canonicalUrl,
        ogDescription: null,
        ogImage: 'https://cdn.example.test/avatar.jpg',
    })],
    ['empty target and quote placeholders', canonicalUrl => postHtml({
        username: 'restricted.user',
        pageUrl: canonicalUrl,
        ogDescription: null,
        chunks: [{
            code: 'RestrictedPost',
            caption: { text: ' \n\t ' },
            text_post_app_info: {
                share_info: { quoted_post: { code: 'HiddenQuote', caption: { text: ' \n ' } } },
            },
        }],
    })],
]) {
    test(`resolved share with ${label} returns a notice instead of an empty embed`, async () => {
        const shareUrl = 'https://www.threads.com/share/BAUdmhsNSI/';
        const canonicalUrl = 'https://www.threads.com/@restricted.user/post/RestrictedPost';
        const redirectedUrl = `${canonicalUrl}?xmt=tracking`;
        const result = await withFetchScript([
            { url: shareUrl, status: 302, location: redirectedUrl },
            { url: redirectedUrl, html: page(canonicalUrl) },
        ], () => threads.resolve(shareUrl));

        assertUnavailableNotice(result, canonicalUrl);
        assert.equal(JSON.stringify(result).includes('Unrelated recommendation'), false);
    });
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
        'https://www.threads.com/@kulomi.i/post/DbyOIPhiRB0',
    );
});

test('private-profile login notice links to the canonical www post URL', async () => {
    const canonicalUrl = 'https://www.threads.com/@private.user/post/PrivatePost';
    const result = await withFetchScript([
        { url: canonicalUrl, status: 302, location: '/?error=invalid_post' },
        { url: INVALID_POST_URL },
        { url: 'https://www.threads.com/@private.user', status: 302, location: '/login' },
    ], () => threads.resolve('https://threads.net/@private.user/post/PrivatePost?xmt=tracking'));

    assert.equal(result.type, 'notice');
    assert.equal(result.message, LOCK_NOTICE);
    assert.equal(result.components[0].components[0].url, canonicalUrl);
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

    assertUnavailableNotice(result, canonicalUrl);
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

for (const [label, content] of [
    ['image', imageMedia('https://cdn.example.test/no-caption.jpg')],
    ['video', { video_versions: [{ url: 'https://cdn.example.test/no-caption.mp4', width: 1280 }] }],
    ['quoted text', {
        text_post_app_info: { share_info: { quoted_post: {
            code: 'QuotedOnly', user: { username: 'quoted.user' }, caption: { text: 'Quoted text' },
        } } },
    }],
    ['quoted image', {
        text_post_app_info: { share_info: { quoted_post: {
            code: 'QuotedOnly', user: { username: 'quoted.user' },
            ...imageMedia('https://cdn.example.test/quoted-only.jpg'),
        } } },
    }],
    ['poll', { caption_add_on: { poll: { tallies: [{ text: 'Yes', count: 2 }, { text: 'No', count: 0 }] } } }],
]) {
    test(`a captionless post containing ${label} still produces its content`, async () => {
        const canonicalUrl = 'https://www.threads.com/@target.user/post/ContentOnly';
        const steps = [{ url: canonicalUrl, html: postHtml({
            pageUrl: canonicalUrl,
            ogDescription: null,
            chunks: [{ code: 'ContentOnly', caption: { text: '' }, ...content }],
        }) }];
        if (label === 'video') {
            steps.push({ url: content.video_versions[0].url, manual: false, bodyChunks: ['video'] });
        }
        const result = await withFetchScript(steps, () => threads.resolve(canonicalUrl));
        assert.equal(result.type, 'embed');
        assert.equal(result.embed.description, undefined);
        assert.equal(result.components[0].components[0].url, canonicalUrl);
        if (label === 'image') assert.equal(result.embed.image.url, 'https://cdn.example.test/no-caption.jpg');
        if (label === 'video') assert.equal(result.files[0].name, 'ContentOnly_0.mp4');
        if (label === 'quoted image') assert.equal(result.embed.image.url, 'https://cdn.example.test/quoted-only.jpg');
        if (label === 'quoted text') assert.equal(result.embed.fields[0].value, 'Quoted text');
        if (label === 'poll') assert.match(result.embed.fields[0].value, /Yes[\s\S]*No/);
    });
}

test('a finished poll with unavailable tallies keeps a result field after a username redirect', async () => {
    const initialUrl = 'https://threads.com/@old.user/post/LivePoll';
    const redirectedUrl = 'https://www.threads.com/@new.user/post/LivePoll?xmt=tracking';
    const canonicalUrl = 'https://www.threads.com/@new.user/post/LivePoll';
    const html = postHtml({
        username: 'new.user',
        pageUrl: canonicalUrl,
        chunks: [{
            code: 'LivePoll',
            user: { username: 'new.user' },
            caption: { text: '最好用的杯子是哪個' },
            caption_add_on: {
                poll: {
                    __typename: 'XDTPollSticker',
                    expires_at: null,
                    finished: true,
                    tallies: null,
                    viewer_can_vote: false,
                    poll_id: '17938639059071786',
                    id: 'polling_sticker_vibrant',
                },
            },
        }],
    });

    const result = await withFetchScript([
        { url: initialUrl.replace('https://threads.com', 'https://www.threads.com'), status: 302, location: redirectedUrl },
        { url: redirectedUrl, html },
    ], () => threads.resolve(initialUrl));

    assert.equal(result.type, 'embed');
    const pollField = result.embed.fields?.find(field => field.name === '📊 投票結果');
    assert.ok(pollField);
    assert.match(pollField.value, /投票結果暫時無法取得|尚未提供|無法取得/);
    assert.doesNotMatch(pollField.value, /0 票|0\.0%/);
    assert.match(pollField.value, /已結束/);
    assert.equal(result.components[0].components[0].url, canonicalUrl);
    assert.equal(result.originalUrl, canonicalUrl);
});

test('compatible exact poll duplicates prefer complete tallies and ignore other-post and quoted polls', async () => {
    const canonicalUrl = 'https://www.threads.com/@target.user/post/PollDuplicate';
    const identity = {
        id: 'poll-duplicate-id',
        pk: 'poll-duplicate-pk',
        code: 'PollDuplicate',
        user: { username: 'target.user' },
    };
    const html = postHtml({
        pageUrl: canonicalUrl,
        chunks: [
            {
                ...identity,
                caption: { text: 'Duplicate poll caption' },
                caption_add_on: {
                    poll: {
                        finished: true,
                        tallies: null,
                        viewer_can_vote: false,
                    },
                },
                text_post_app_info: {
                    share_info: {
                        quoted_post: {
                            code: 'QuotedPoll',
                            user: { username: 'quoted.user' },
                            caption_add_on: {
                                poll: {
                                    finished: true,
                                    tallies: [{ text: 'Quoted leak', count: 99 }],
                                },
                            },
                        },
                    },
                },
            },
            {
                ...identity,
                caption_add_on: {
                    poll: {
                        finished: true,
                        tallies: [{ text: 'Partial stale option' }],
                        viewer_can_vote: false,
                    },
                },
            },
            {
                ...identity,
                caption_add_on: {
                    poll: {
                        finished: true,
                        tallies: [
                            { text: 'Yes', count: 2 },
                            { text: 'No', count: 0 },
                        ],
                        viewer_can_vote: false,
                    },
                },
            },
            {
                code: 'OtherPost',
                caption_add_on: {
                    poll: {
                        finished: true,
                        tallies: [{ text: 'Other post leak', count: 77 }],
                    },
                },
            },
        ],
    });

    const result = await withFetchScript([
        { url: canonicalUrl, html },
    ], () => threads.resolve(canonicalUrl));

    assert.equal(result.type, 'embed');
    const pollField = result.embed.fields?.find(field => field.name === '📊 投票結果');
    assert.ok(pollField);
    assert.match(pollField.value, /Yes[\s\S]*No/);
    assert.doesNotMatch(pollField.value, /Partial stale option|Quoted leak|Other post leak/);
    assert.doesNotMatch(pollField.value, /投票結果暫時無法取得|尚未提供|無法取得/);
});

test('complete poll results preserve finished metadata, percentages, and genuine zero counts', async () => {
    const canonicalUrl = 'https://www.threads.com/@target.user/post/CompletePoll';
    const html = postHtml({
        pageUrl: canonicalUrl,
        chunks: [{
            code: 'CompletePoll',
            user: { username: 'target.user' },
            caption: { text: 'Complete poll caption' },
            caption_add_on: {
                poll: {
                    finished: true,
                    expires_at: null,
                    viewer_can_vote: false,
                    tallies: [
                        { text: 'A', count: 2 },
                        { text: 'B', count: '1' },
                        { text: 'Zero', count: 0 },
                    ],
                },
            },
        }],
    });

    const result = await withFetchScript([
        { url: canonicalUrl, html },
    ], () => threads.resolve(canonicalUrl));

    const pollField = result.embed.fields?.find(field => field.name === '📊 投票結果');
    assert.ok(pollField);
    assert.match(pollField.value, /A[\s\S]*66\.7%[\s\S]*2 票/);
    assert.match(pollField.value, /B[\s\S]*33\.3%[\s\S]*1 票/);
    assert.match(pollField.value, /Zero[\s\S]*0\.0%[\s\S]*0 票/);
    assert.match(pollField.value, /共 \*\*3\*\* 票/);
    assert.match(pollField.value, /已結束/);
    assert.doesNotMatch(pollField.value, /投票結果暫時無法取得|尚未提供|無法取得/);
});

for (const [label, tallies] of [['null', null], ['empty', []], ['missing', undefined]]) {
    test(`a captionless poll with ${label} tallies remains visible`, async () => {
        const canonicalUrl = 'https://www.threads.com/@target.user/post/UnavailablePollOnly';
        const result = await withFetchScript([{ url: canonicalUrl, html: postHtml({
            pageUrl: canonicalUrl,
            ogDescription: null,
            chunks: [{
                code: 'UnavailablePollOnly',
                caption: { text: '' },
                caption_add_on: { poll: {
                    __typename: 'XDTPollSticker',
                    finished: false,
                    expires_at: '1800000000',
                    tallies,
                } },
            }],
        }) }], () => threads.resolve(canonicalUrl));

        assert.equal(result.type, 'embed');
        assert.equal(result.embed.description, undefined);
        assert.equal(result.embed.color, 0xFEE75C);
        const field = result.embed.fields[0];
        assert.equal(field.name, '📊 投票');
        assert.match(field.value, /投票結果暫時無法取得/);
        assert.match(field.value, /<t:1800000000:R>/);
        assert.doesNotMatch(field.value, /0 票|0\.0%/);
    });
}

for (const [label, badCount] of [
    ['missing', undefined],
    ['null', null],
    ['empty string', ''],
    ['boolean false', false],
    ['negative', -1],
    ['non-numeric string', 'NaN'],
    ['fractional', 1.5],
]) {
    test(`poll ${label} count never renders as zero results`, async () => {
        const code = `InvalidPollCount_${label.replace(/[^A-Za-z0-9]/g, '')}`;
        const canonicalUrl = `https://www.threads.com/@target.user/post/${code}`;
        const tally = { text: 'Bad count' };
        if (badCount !== undefined) tally.count = badCount;
        const html = postHtml({
            pageUrl: canonicalUrl,
            chunks: [{
                code,
                user: { username: 'target.user' },
                caption: { text: 'Invalid poll count caption' },
                caption_add_on: {
                    poll: {
                        finished: true,
                        tallies: [tally],
                    },
                },
            }],
        });

        const result = await withFetchScript([
            { url: canonicalUrl, html },
        ], () => threads.resolve(canonicalUrl));

        const pollField = result.embed.fields?.find(field => field.name === '📊 投票結果');
        assert.ok(pollField);
        assert.match(pollField.value, /投票結果暫時無法取得|尚未提供|無法取得/);
        assert.doesNotMatch(pollField.value, /0 票|0\.0%/);
    });
}

for (const [label, captionAddOn] of [
    ['an empty poll object', { poll: {} }],
    ['no poll object', undefined],
]) {
    test(`${label} does not create a poll field`, async () => {
        const canonicalUrl = `https://www.threads.com/@target.user/post/${label === 'an empty poll object' ? 'EmptyPoll' : 'NoPoll'}`;
        const content = {
            code: label === 'an empty poll object' ? 'EmptyPoll' : 'NoPoll',
            user: { username: 'target.user' },
            caption: { text: 'Ordinary text caption' },
        };
        if (captionAddOn !== undefined) content.caption_add_on = captionAddOn;
        const html = postHtml({
            pageUrl: canonicalUrl,
            chunks: [content],
        });

        const result = await withFetchScript([
            { url: canonicalUrl, html },
        ], () => threads.resolve(canonicalUrl));

        assert.equal(result.type, 'embed');
        assert.equal(result.embed.fields, undefined);
    });
}

test('an empty duplicate caption cannot hide readable text in another exact target object', async () => {
    const canonicalUrl = 'https://www.threads.com/@target.user/post/DuplicateCaption';
    const result = await withFetchScript([{ url: canonicalUrl, html: postHtml({
        pageUrl: canonicalUrl,
        ogDescription: null,
        chunks: [
            { code: 'DuplicateCaption', caption: { text: ' \n ' }, user: { username: 'target.user' } },
            { code: 'DuplicateCaption', caption: { text: 'Readable caption' } },
        ],
    }) }], () => threads.resolve(canonicalUrl));
    assertEmbedResult(result, { canonicalUrl, description: 'Readable caption' });
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

for (const permalink of [
    'https://threads.com/@quoted.user/post/QuotedCode?xmt=tracking',
    'https://threads.net/@quoted.user/post/QuotedCode',
    '/@quoted.user/post/QuotedCode',
]) {
    test(`quoted permalink fallback normalizes to www: ${permalink}`, async () => {
        const canonicalUrl = 'https://www.threads.com/@target.user/post/QuotePermalink';
        const html = postHtml({
            pageUrl: canonicalUrl,
            chunks: [{
                code: 'QuotePermalink',
                caption: { text: 'Outer quote caption' },
                text_post_app_info: {
                    share_info: {
                        quoted_post: {
                            code: 'QuotedCode',
                            permalink,
                            caption: { text: 'Quoted post caption' },
                        },
                    },
                },
            }],
        });

        const result = await withFetchScript([
            { url: canonicalUrl, html },
        ], () => threads.resolve(canonicalUrl));

        const quotedButton = result.components[0].components[1];
        assert.equal(quotedButton.label, '開啟引用原文');
        assert.equal(quotedButton.url, 'https://www.threads.com/@quoted.user/post/QuotedCode');
    });
}

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

    assertUnavailableNotice(result, canonicalUrl);
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

    assertUnavailableNotice(result, canonicalUrl);
    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes('Wrong OG description'), false);
    assert.equal(serialized.includes('wrong-og-image.jpg'), false);
    assert.equal(serialized.includes('Wrong SJS caption'), false);
    assert.equal(serialized.includes('wrong-sjs-image.jpg'), false);
});

test('Threads footer formats all interaction counts in the documented order', async () => {
    const canonicalUrl = 'https://www.threads.com/@target.user/post/EngagementTarget';
    const html = postHtml({
        pageUrl: canonicalUrl,
        chunks: [{
            code: 'EngagementTarget',
            user: { username: 'target.user' },
            caption: { text: 'Engagement target caption' },
            like_count: '18141',
            text_post_app_info: {
                direct_reply_count: 4738,
                repost_count: 585,
                quote_count: 250,
                reshare_count: '496',
            },
        }],
    });

    const result = await withFetchScript([
        { url: canonicalUrl, html },
    ], () => threads.resolve(canonicalUrl));

    assertEmbedResult(result, {
        canonicalUrl,
        description: 'Engagement target caption',
    });
    assertEmbedFooter(result, 'Threads • ❤️ 18,141 • 💬 4,738 • 🔁 835 • ✈️ 496');
});

for (const {
    label,
    code,
    likeCount,
    directReplyCount,
    repostCount,
    quoteCount,
    reshareCount,
    footer,
} of [
    {
        label: 'invalid values',
        code: 'InvalidEngagement',
        likeCount: null,
        directReplyCount: -1,
        repostCount: 1.5,
        quoteCount: true,
        reshareCount: '4.2',
        footer: 'Threads • ❤️ — • 💬 — • 🔁 — • ✈️ —',
    },
    {
        label: 'zero values',
        code: 'ZeroEngagement',
        likeCount: 0,
        directReplyCount: 0,
        repostCount: 0,
        quoteCount: 0,
        reshareCount: 0,
        footer: 'Threads • ❤️ 0 • 💬 0 • 🔁 0 • ✈️ 0',
    },
    {
        label: 'missing quote repost count',
        code: 'MissingQuoteEngagement',
        likeCount: 1,
        directReplyCount: 2,
        repostCount: 3,
        reshareCount: 4,
        footer: 'Threads • ❤️ 1 • 💬 2 • 🔁 — • ✈️ 4',
    },
    {
        label: 'repost sum overflow',
        code: 'OverflowEngagement',
        likeCount: 0,
        directReplyCount: 0,
        repostCount: Number.MAX_SAFE_INTEGER,
        quoteCount: 1,
        reshareCount: 0,
        footer: 'Threads • ❤️ 0 • 💬 0 • 🔁 — • ✈️ 0',
    },
]) {
    test(`interaction footer handles ${label}`, async () => {
        const canonicalUrl = `https://www.threads.com/@target.user/post/${code}`;
        const html = postHtml({
            pageUrl: canonicalUrl,
            chunks: [{
                code,
                user: { username: 'target.user' },
                caption: { text: `${label} engagement caption` },
                like_count: likeCount,
                text_post_app_info: {
                    direct_reply_count: directReplyCount,
                    repost_count: repostCount,
                    ...(quoteCount === undefined ? {} : { quote_count: quoteCount }),
                    reshare_count: reshareCount,
                },
            }],
        });

        const result = await withFetchScript([
            { url: canonicalUrl, html },
        ], () => threads.resolve(canonicalUrl));

        assertEmbedResult(result, {
            canonicalUrl,
            description: `${label} engagement caption`,
        });
        assertEmbedFooter(result, footer);
    });
}

test('interaction counts stay isolated from quoted, replied, and recommended posts', async () => {
    const canonicalUrl = 'https://www.threads.com/@target.user/post/IsolatedEngagement';
    const unrelatedStats = {
        like_count: 999,
        text_post_app_info: {
            direct_reply_count: 888,
            repost_count: 777,
            quote_count: 666,
            reshare_count: 555,
        },
    };
    const html = postHtml({
        pageUrl: canonicalUrl,
        chunks: [{
            code: 'IsolatedEngagement',
            user: { username: 'target.user' },
            caption: { text: 'Isolated engagement caption' },
            text_post_app_info: {
                share_info: {
                    quoted_post: {
                        code: 'QuotedEngagement',
                        user: { username: 'quoted.user' },
                        caption: { text: 'Quoted content' },
                        ...unrelatedStats,
                    },
                },
            },
            replies: [{
                code: 'ReplyEngagement',
                user: { username: 'reply.user' },
                ...unrelatedStats,
            }],
            recommendations: [{
                code: 'RecommendedEngagement',
                user: { username: 'recommended.user' },
                ...unrelatedStats,
            }],
        }],
    });

    const result = await withFetchScript([
        { url: canonicalUrl, html },
    ], () => threads.resolve(canonicalUrl));

    assertEmbedResult(result, {
        canonicalUrl,
        description: 'Isolated engagement caption',
    });
    assertEmbedFooter(result, 'Threads • ❤️ — • 💬 — • 🔁 — • ✈️ —');
});

test('compatible target duplicates fill interaction counts column by column', async () => {
    const canonicalUrl = 'https://www.threads.com/@target.user/post/DuplicateEngagement';
    const identity = {
        id: 'engagement-post-id',
        pk: 'engagement-post-pk',
        code: 'DuplicateEngagement',
        user: { username: 'target.user' },
    };
    const html = postHtml({
        pageUrl: canonicalUrl,
        chunks: [
            {
                ...identity,
                caption: { text: 'Duplicate engagement caption' },
                like_count: 18141,
                text_post_app_info: { direct_reply_count: 4738 },
            },
            {
                ...identity,
                text_post_app_info: {
                    repost_count: 585,
                    quote_count: 250,
                    reshare_count: 496,
                },
            },
        ],
    });

    const result = await withFetchScript([
        { url: canonicalUrl, html },
    ], () => threads.resolve(canonicalUrl));

    assertEmbedResult(result, {
        canonicalUrl,
        description: 'Duplicate engagement caption',
    });
    assertEmbedFooter(result, 'Threads • ❤️ 18,141 • 💬 4,738 • 🔁 835 • ✈️ 496');
});

test('failed media download keeps the engagement footer and appends its warning', async () => {
    const canonicalUrl = 'https://www.threads.com/@target.user/post/FailedEngagementMedia';
    const videoUrl = 'https://cdn.example.test/failed-engagement.mp4';
    const html = postHtml({
        pageUrl: canonicalUrl,
        chunks: [{
            code: 'FailedEngagementMedia',
            user: { username: 'target.user' },
            caption: { text: 'Failed media caption' },
            like_count: 18141,
            video_versions: [{ url: videoUrl, width: 1280 }],
            text_post_app_info: {
                direct_reply_count: 4738,
                repost_count: 585,
                quote_count: 250,
                reshare_count: 496,
            },
        }],
    });

    const result = await withFetchScript([
        { url: canonicalUrl, html },
        { url: videoUrl, status: 503, manual: false },
    ], () => threads.resolve(canonicalUrl));

    assertEmbedResult(result, {
        canonicalUrl,
        description: 'Failed media caption',
    });
    assertEmbedFooter(
        result,
        'Threads • ❤️ 18,141 • 💬 4,738 • 🔁 835 • ✈️ 496 • 1 個媒體下載失敗',
    );
});

test('oversized media keeps the engagement footer and appends its warning', async () => {
    const canonicalUrl = 'https://www.threads.com/@target.user/post/OversizedEngagementMedia';
    const imageUrls = Array.from({ length: 5 }, (_, index) =>
        `https://cdn.example.test/oversized-engagement-${index}.jpg`
    );
    const html = postHtml({
        pageUrl: canonicalUrl,
        chunks: [{
            code: 'OversizedEngagementMedia',
            user: { username: 'target.user' },
            caption: { text: 'Oversized media caption' },
            carousel_media: imageUrls.map(url => imageMedia(url)),
            like_count: 18141,
            text_post_app_info: {
                direct_reply_count: 4738,
                repost_count: 585,
                quote_count: 250,
                reshare_count: 496,
            },
        }],
    });

    const result = await withFetchScript([
        { url: canonicalUrl, html },
        {
            url: imageUrls[4],
            manual: false,
            declaredContentLength: 10 * 1024 * 1024 + 1,
        },
    ], () => threads.resolve(canonicalUrl));

    assertEmbedResult(result, {
        canonicalUrl,
        description: 'Oversized media caption',
        imageUrl: imageUrls[0],
    });
    assertEmbedFooter(
        result,
        'Threads • ❤️ 18,141 • 💬 4,738 • 🔁 835 • ✈️ 496 • 1 個媒體超過 10MB 未附上',
    );
});
