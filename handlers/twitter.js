// handlers/twitter.js

module.exports = {
	name: 'twitter',

	match(hostname) {
		return hostname === 'x.com' || hostname === 'twitter.com';
	},

	async resolve(url) {
		const newUrl = url
			.replace(/^(https?:\/\/)(www\.)?(x|twitter)\.com/, '$1fixvx.com')
			.split('?')[0];
		return newUrl !== url ? newUrl : null;
	},
};
