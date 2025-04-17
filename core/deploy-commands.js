const fs = require('fs');
const path = require('path');
const { REST, Routes } = require('discord.js');
require('dotenv').config();

const commands = [];
const commandsPath = path.join(__dirname, '../commands');

function loadCommands(dir) {
	const files = fs.readdirSync(dir, { withFileTypes: true });

	for (const file of files) {
		const filePath = path.join(dir, file.name);
		if (file.isDirectory()) {
			loadCommands(filePath); // 遞迴讀取子資料夾
		} else if (file.name.endsWith('.js')) {
			const command = require(filePath);
			if ('data' in command && 'execute' in command) {
				commands.push(command.data.toJSON());
			} else {
				console.warn(`[警告] 檔案 ${file.name} 缺少必要的 "data" 或 "execute" 屬性。`);
			}
		}
	}
}

loadCommands(commandsPath);

const rest = new REST().setToken(process.env.DISCORD_TOKEN);

(async () => {
	try {
		console.log(`🛰️ 開始註冊 ${commands.length} 個應用程式指令...`);

		await rest.put(
			Routes.applicationCommands(process.env.CLIENT_ID),
			{ body: commands },
		);

		console.log('✅ 指令註冊成功！');
	} catch (error) {
		console.error('❌ 指令註冊失敗：', error);
	}
})();
