// handlers/index.js
// 自動載入 handlers/ 目錄下所有 handler 模組

const fs = require('fs');
const path = require('path');
const { validateHandlers } = require('../core/url-config');

const handlers = [];
const handlerFiles = fs.readdirSync(__dirname).filter(
	file => file.endsWith('.js') && file !== 'index.js'
).sort();

for (const file of handlerFiles) {
	const handler = require(path.join(__dirname, file));
	if (handler.name && handler.match && handler.resolve) {
		handlers.push(handler);
	} else {
		console.warn(`[警告] handler 檔案 ${file} 缺少必要屬性 (name, match, resolve)`);
	}
}

// 專用處理器優先，且禁止設定檔重複宣告其來源網域（停用時亦不走替代規則）。
handlers.sort((a, b) => Number(a.name === 'simple') - Number(b.name === 'simple'));
validateHandlers(handlers);

module.exports = handlers;
