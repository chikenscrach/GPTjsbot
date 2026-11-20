const { normalizeHostname, settings } = require('../core/url-config');
const { TWITTER_PROVIDERS, twitterLanguageSuffix } = require('../utils/twitter');

// 只在貼文或指定媒體的網址附加語言，保留個人頁面與手動指定的語言。
const postPath = /^(?:\/(?:\w+|i\/web))?\/status(?:es)?\/\d+(?:\/(?:photo|video)\/[1-4])?\/?$/;

function match(hostname) {
	return hostname === 'x.com' || hostname === 'twitter.com';
}

function matchPreview(hostname) {
	return TWITTER_PROVIDERS.includes(hostname);
}

module.exports = {
	name: 'twitter',
	match,
	matchPreview,

	async resolve(url, { targetHost, language } = settings.handlers.twitter) {
		let parsed;
		try {
			parsed = new URL(url);
		} catch {
			return null;
		}
		if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.port) return null;
		const host = normalizeHostname(parsed.hostname);
		const preview = matchPreview(host);
		if (!preview && !match(host)) return null;

		const provider = preview ? host : targetHost;
		const suffix = twitterLanguageSuffix(language, provider);
		if (suffix && postPath.test(parsed.pathname)) {
			parsed.pathname = `${parsed.pathname.replace(/\/$/, '')}/${suffix}`;
		} else if (preview) {
			return null;
		}
		parsed.hostname = provider;
		parsed.search = '';
		return parsed.href;
	},
};
