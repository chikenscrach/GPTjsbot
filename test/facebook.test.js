'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const facebook = require('../handlers/facebook');

const VIDEO_ID = '2131571174111471';
const LONG_VIDEO_URL = `https://www.facebook.com/100061392164319/videos/yup-thats-enough-fb-for-tonightsauce-chainsmoker-cat/${VIDEO_ID}/`;
const SHORT_VIDEO_URL = `https://www.facebook.com/100061392164319/videos/${VIDEO_ID}`;
const WATCH_URL = `https://www.facebook.com/watch/?v=${VIDEO_ID}`;
const SHARE_URL = 'https://www.facebook.com/share/v/1F6agFqkjq';
const FACEBED_VIDEO_URL = `https://facebed.com/watch/?v=${VIDEO_ID}`;

const videoCases = [
	{
		name: 'long video canonical loses its title and tracking parameters',
		input: LONG_VIDEO_URL,
		html: `<link rel="canonical" href="${LONG_VIDEO_URL}?fbclid=tracking&amp;mibextid=tracking#details">`,
	},
	{
		name: 'share video redirect resolves without metadata or a post embed request',
		input: SHARE_URL,
		finalUrl: `${LONG_VIDEO_URL}?rdid=tracking&share_url=tracking`,
	},
	{
		name: 'share video resolves from og:url when the response URL is unchanged',
		input: SHARE_URL,
		html: `<meta property="og:url" content="${LONG_VIDEO_URL}">`,
	},
	{
		name: 'fb.watch redirect resolves to the same short video URL',
		input: 'https://fb.watch/example/',
		finalUrl: LONG_VIDEO_URL,
	},
	{
		name: 'login next preserves the video ID after a share redirect',
		input: SHARE_URL,
		finalUrl: `https://www.facebook.com/login/?next=${encodeURIComponent(LONG_VIDEO_URL)}`,
		html: '<link rel="canonical" href="https://www.facebook.com/login/">',
	},
	{
		name: 'a known input video survives a login page without next',
		input: LONG_VIDEO_URL,
		finalUrl: 'https://www.facebook.com/login/',
		html: '<link rel="canonical" href="https://www.facebook.com/login/">',
	},
	{
		name: 'short owner video URLs normalize with an optional trailing slash',
		input: `${SHORT_VIDEO_URL}/`,
	},
	{
		name: 'watch URLs keep the video ID while dropping tracking parameters',
		input: `${WATCH_URL}&fbclid=tracking&ref=share#details`,
	},
	{
		name: 'a numeric title is not mistaken for the final video ID',
		input: `https://m.facebook.com/example/videos/123456/${VIDEO_ID}`,
	},
];

for (const { name, input, finalUrl = input, html = '' } of videoCases) {
	test(name, async (t) => {
		const fetchMock = t.mock.method(global, 'fetch', async () => ({
			status: 200,
			url: finalUrl,
			text: async () => html,
		}));

		assert.equal(await facebook.resolve(input), FACEBED_VIDEO_URL);
		assert.equal(fetchMock.mock.callCount(), 1, 'known videos should not request a post embed');
		assert.equal(fetchMock.mock.calls[0].arguments[0], input);
		assert.equal(fetchMock.mock.calls[0].arguments[1].redirect, 'follow');
	});
}

for (const [path, expectedPath] of [
	['/example/videos/title/not-a-video-id/', '/example/videos/title/not-a-video-id/'],
	['/example/posts/2131571174111471', '/example/posts/2131571174111471'],
	['/groups/123456/posts/2131571174111471', '/groups/123456/permalink/2131571174111471'],
]) {
	test(`non-video canonical keeps its existing conversion: ${path}`, async (t) => {
		const input = `https://www.facebook.com${path}`;
		t.mock.method(global, 'fetch', async () => ({
			status: 200,
			url: input,
			text: async () => `<link rel="canonical" href="${input}">`,
		}));

		assert.equal(await facebook.resolve(input), `https://facebed.com${expectedPath}`);
	});
}

test('photo permalink resolves to its parent post through the embed page', async () => {
	const inputUrl = 'https://www.facebook.com/miyu.alfarabi/photos/sayuris-favorite-ice-cream-sardine-ice-cream/4624261864564289/';
	const canonicalUrl = 'https://www.facebook.com/photo/?fbid=4624261864564289&amp;set=a.1399702273686947';
	const expectedEmbedUrl = `https://www.facebook.com/plugins/post.php?href=${encodeURIComponent(inputUrl)}&show_text=true&width=500`;
	const embedHtml = `${' '.repeat(3000)}<a href="/miyu.alfarabi/posts/4624261904564285?ref=embed_post">post</a>`;
	const fetchCalls = [];
	const originalFetch = global.fetch;

	global.fetch = async (url, options) => {
		fetchCalls.push({ url: String(url), options });

		if (fetchCalls.length === 1) {
			return {
				status: 200,
				url: inputUrl,
				text: async () => `<link rel="canonical" href="${canonicalUrl}">`,
			};
		}

		if (fetchCalls.length === 2) {
			return {
				status: 200,
				url: expectedEmbedUrl,
				text: async () => embedHtml,
			};
		}

		throw new Error(`unexpected fetch: ${url}`);
	};

	try {
		const result = await facebook.resolve(inputUrl);

		assert.equal(result, 'https://facebed.com/miyu.alfarabi/posts/4624261904564285');
		assert.equal(fetchCalls.length, 2);
		assert.equal(fetchCalls[0].url, inputUrl);
		assert.equal(fetchCalls[0].options.redirect, 'follow');
		assert.equal(fetchCalls[1].url, expectedEmbedUrl);
		assert.equal(fetchCalls[1].options.redirect, undefined);
	} finally {
		global.fetch = originalFetch;
	}
});

test('photo fbid resolves a gm parent post through the embed photo link', async () => {
	const inputUrl = 'https://www.facebook.com/photo/?fbid=2169155400677688';
	const canonicalUrl = 'https://www.facebook.com/rodolfo.brarcenas.9/photos/this-team-is-wild/2169155400677688/';
	const expectedEmbedUrl = `https://www.facebook.com/plugins/post.php?href=${encodeURIComponent(inputUrl)}&show_text=true&width=500`;
	const parentId = '1397664659240620';
	const parentLookupUrl = `https://www.facebook.com/${parentId}`;
	const parentUrl = `https://www.facebook.com/groups/zenlesszonezeroglobal1/posts/${parentId}/`;
	const embedHtml = `${' '.repeat(3000)}<a href="https://www.facebook.com/photo.php?fbid=2169155400677688&amp;set=gm.${parentId}&amp;type=3&amp;ref=embed_post">photo</a>`;
	const parentHtml = `<link rel="canonical" href="${parentUrl}"><meta property="og:url" content="${parentUrl}">`;
	const fetchCalls = [];
	const originalFetch = global.fetch;

	global.fetch = async (url, options) => {
		fetchCalls.push({ url: String(url), options });

		if (fetchCalls.length === 1) {
			return {
				status: 200,
				url: inputUrl,
				text: async () => `<link rel="canonical" href="${canonicalUrl}">`,
			};
		}

		if (fetchCalls.length === 2) {
			return {
				status: 200,
				url: expectedEmbedUrl,
				text: async () => embedHtml,
			};
		}

		if (fetchCalls.length === 3) {
			return {
				status: 200,
				url: parentUrl,
				text: async () => parentHtml,
			};
		}

		throw new Error(`unexpected fetch: ${url}`);
	};

	try {
		const result = await facebook.resolve(inputUrl);

		assert.equal(result, `https://facebed.com/groups/zenlesszonezeroglobal1/posts/${parentId}`);
		assert.equal(fetchCalls.length, 3);
		assert.equal(fetchCalls[0].url, inputUrl);
		assert.equal(fetchCalls[0].options.redirect, 'follow');
		assert.equal(fetchCalls[1].url, expectedEmbedUrl);
		assert.equal(fetchCalls[2].url, parentLookupUrl);
		assert.equal(fetchCalls[2].options.redirect, 'follow');
	} finally {
		global.fetch = originalFetch;
	}
});

test('photo embed with an unrelated fbid keeps the photo fallback', async () => {
	const inputUrl = 'https://www.facebook.com/photo/?fbid=2169155400677688';
	const canonicalUrl = 'https://www.facebook.com/rodolfo.brarcenas.9/photos/this-team-is-wild/2169155400677688/';
	const expectedEmbedUrl = `https://www.facebook.com/plugins/post.php?href=${encodeURIComponent(inputUrl)}&show_text=true&width=500`;
	const embedHtml = `${' '.repeat(3000)}<a href="https://www.facebook.com/photo.php?fbid=9999999999999999&amp;set=gm.1397664659240620&amp;type=3&amp;ref=embed_post">photo</a>`;
	const fetchCalls = [];
	const originalFetch = global.fetch;

	global.fetch = async (url, options) => {
		fetchCalls.push({ url: String(url), options });

		if (fetchCalls.length === 1) {
			return {
				status: 200,
				url: inputUrl,
				text: async () => `<link rel="canonical" href="${canonicalUrl}">`,
			};
		}

		if (fetchCalls.length === 2) {
			return {
				status: 200,
				url: expectedEmbedUrl,
				text: async () => embedHtml,
			};
		}

		throw new Error(`unexpected fetch: ${url}`);
	};

	try {
		const result = await facebook.resolve(inputUrl);

		assert.equal(result, 'https://facebed.com/photo.php?fbid=2169155400677688&type=3');
		assert.equal(fetchCalls.length, 2);
		assert.equal(fetchCalls[1].url, expectedEmbedUrl);
	} finally {
		global.fetch = originalFetch;
	}
});

for (const { name, parentResponse } of [
	{
		name: 'non-200 response',
		parentResponse: {
			status: 500,
			url: 'https://www.facebook.com/1397664659240620',
			text: async () => '',
		},
	},
	{
		name: 'different post ID',
		parentResponse: {
			status: 200,
			url: 'https://www.facebook.com/groups/zenlesszonezeroglobal1/posts/9999999999999999/',
			text: async () => '<link rel="canonical" href="https://www.facebook.com/groups/zenlesszonezeroglobal1/posts/9999999999999999/">',
		},
	},
	{
		name: 'login response without group metadata',
		parentResponse: {
			status: 200,
			url: 'https://www.facebook.com/login/',
			text: async () => '<link rel="canonical" href="https://www.facebook.com/login/">',
		},
	},
]) {
	test(`photo gm parent lookup keeps the photo fallback on ${name}`, async () => {
		const inputUrl = 'https://www.facebook.com/photo/?fbid=2169155400677688';
		const canonicalUrl = 'https://www.facebook.com/rodolfo.brarcenas.9/photos/this-team-is-wild/2169155400677688/';
		const expectedEmbedUrl = `https://www.facebook.com/plugins/post.php?href=${encodeURIComponent(inputUrl)}&show_text=true&width=500`;
		const embedHtml = `${' '.repeat(3000)}<a href="https://www.facebook.com/photo.php?fbid=2169155400677688&amp;set=gm.1397664659240620&amp;type=3&amp;ref=embed_post">photo</a>`;
		const fetchCalls = [];
		const originalFetch = global.fetch;

		global.fetch = async (url, options) => {
			fetchCalls.push({ url: String(url), options });

			if (fetchCalls.length === 1) {
				return {
					status: 200,
					url: inputUrl,
					text: async () => `<link rel="canonical" href="${canonicalUrl}">`,
				};
			}

			if (fetchCalls.length === 2) {
				return {
					status: 200,
					url: expectedEmbedUrl,
					text: async () => embedHtml,
				};
			}

			if (fetchCalls.length === 3) return parentResponse;
			throw new Error(`unexpected fetch: ${url}`);
		};

		try {
			const result = await facebook.resolve(inputUrl);

			assert.equal(result, 'https://facebed.com/photo.php?fbid=2169155400677688&type=3');
			assert.equal(fetchCalls.length, 3);
			assert.equal(fetchCalls[2].url, 'https://www.facebook.com/1397664659240620');
		} finally {
			global.fetch = originalFetch;
		}
	});
}

test('direct group post embed keeps its trailing slash out of the result and accepts ref after another query', async () => {
	const inputUrl = 'https://www.facebook.com/photo/?fbid=2169155400677688';
	const canonicalUrl = 'https://www.facebook.com/rodolfo.brarcenas.9/photos/this-team-is-wild/2169155400677688/';
	const expectedEmbedUrl = `https://www.facebook.com/plugins/post.php?href=${encodeURIComponent(inputUrl)}&show_text=true&width=500`;
	const parentId = '1397664659240620';
	const embedHtml = `${' '.repeat(3000)}<a href="/groups/zenlesszonezeroglobal1/posts/${parentId}/?source=embed&amp;ref=embed_post">post</a>`;
	const fetchCalls = [];
	const originalFetch = global.fetch;

	global.fetch = async (url, options) => {
		fetchCalls.push({ url: String(url), options });

		if (fetchCalls.length === 1) {
			return {
				status: 200,
				url: inputUrl,
				text: async () => `<link rel="canonical" href="${canonicalUrl}">`,
			};
		}

		if (fetchCalls.length === 2) {
			return {
				status: 200,
				url: expectedEmbedUrl,
				text: async () => embedHtml,
			};
		}

		throw new Error(`unexpected fetch: ${url}`);
	};

	try {
		const result = await facebook.resolve(inputUrl);

		assert.equal(result, `https://facebed.com/groups/zenlesszonezeroglobal1/posts/${parentId}`);
		assert.equal(fetchCalls.length, 2);
		assert.equal(fetchCalls[1].url, expectedEmbedUrl);
	} finally {
		global.fetch = originalFetch;
	}
});

test('photo pcb set does not become a photo owner post before resolving the embed parent', async () => {
	const inputUrl = 'https://www.facebook.com/photo/?fbid=2169155400677688&set=pcb.987654321';
	const canonicalUrl = 'https://www.facebook.com/rodolfo.brarcenas.9/photos/this-team-is-wild/2169155400677688/';
	const expectedEmbedUrl = `https://www.facebook.com/plugins/post.php?href=${encodeURIComponent(inputUrl)}&show_text=true&width=500`;
	const parentId = '1397664659240620';
	const embedHtml = `${' '.repeat(3000)}<a href="/groups/zenlesszonezeroglobal1/posts/${parentId}/?ref=embed_post">post</a>`;
	const fetchCalls = [];
	const originalFetch = global.fetch;

	global.fetch = async (url, options) => {
		fetchCalls.push({ url: String(url), options });

		if (fetchCalls.length === 1) {
			return {
				status: 200,
				url: inputUrl,
				text: async () => `<link rel="canonical" href="${canonicalUrl}">`,
			};
		}

		if (fetchCalls.length === 2) {
			return {
				status: 200,
				url: expectedEmbedUrl,
				text: async () => embedHtml,
			};
		}

		throw new Error(`unexpected fetch: ${url}`);
	};

	try {
		const result = await facebook.resolve(inputUrl);

		assert.equal(result, `https://facebed.com/groups/zenlesszonezeroglobal1/posts/${parentId}`);
		assert.equal(fetchCalls.length, 2);
		assert.equal(fetchCalls[1].url, expectedEmbedUrl);
		assert.ok(!result.includes('/photo/posts/'), 'pcb must not use photo as a post owner');
	} finally {
		global.fetch = originalFetch;
	}
});
