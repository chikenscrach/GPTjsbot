'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const facebook = require('../handlers/facebook');

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
