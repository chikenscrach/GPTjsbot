// 簡單網域轉換的內容由 settings.json / settings.example.json 定義。
const { settings, normalizeHostname } = require('../core/url-config');
const rulesByHost = new Map(Object.values(settings.rules)
	.flatMap(rule => rule.hosts.map(host => [host, rule])));

module.exports = {
	name: 'simple',

	match(hostname) {
		return rulesByHost.has(normalizeHostname(hostname));
	},

	getRule(hostname) {
		return rulesByHost.get(normalizeHostname(hostname));
	},

	async resolve(url) {
		try {
			const parsed = new URL(url);
			if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.port) return null;
			const rule = rulesByHost.get(normalizeHostname(parsed.hostname));
			if (!rule) return null;
			parsed.hostname = rule.targetHost;
			if (rule.stripQuery) parsed.search = '';
			const newUrl = parsed.toString();
			return newUrl !== url ? newUrl : null;
		} catch {
			return null;
		}
	},
};
