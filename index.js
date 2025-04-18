require('dotenv').config();
require('./core/db'); // 順便初始化 DB
const fs = require('fs');
const path = require('path');
const { Client, Collection, GatewayIntentBits } = require('discord.js');
const { startScheduler } = require('./core/scheduler');

const client = new Client({
  intents: [
	GatewayIntentBits.Guilds,
	GatewayIntentBits.GuildMessages,
	GatewayIntentBits.MessageContent
  ],
});

client.commands = new Collection();

// 載入所有指令
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
  const filePath = path.join(commandsPath, file);
  const command = require(filePath);
  if ('data' in command && 'execute' in command) {
    client.commands.set(command.data.name, command);
  } else {
    console.warn(`[警告] 指令檔 ${file} 缺少必要屬性 "data" 或 "execute"`);
  }
}

const eventsPath = path.join(__dirname, 'events');
const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));

for (const file of eventFiles) {
	const filePath = path.join(eventsPath, file);
	const event = require(filePath);
	if (event.once) {
		client.once(event.name, (...args) => event.execute(...args));
	} else {
		client.on(event.name, (...args) => event.execute(...args));
	}
}

// Bot 啟動事件
client.once('ready', () => {
	console.log(`✅ 已登入：${client.user.tag}`);
	startScheduler(client);

	client.user.setPresence({
		status: process.env.BOT_STATUS || 'online',
		activities: [{
			type: {
				playing: 0,
				streaming: 1,
				listening: 2,
				watching: 3,
				competing: 5
			}[process.env.BOT_ACTIVITY_TYPE] ?? 0,
			name: process.env.BOT_ACTIVITY_NAME || '使用 /help'
		}]
	});
});


// Slash 指令事件
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(error);
    await interaction.reply({ content: '❌ 執行指令時發生錯誤。', ephemeral: true });
  }
});

client.login(process.env.DISCORD_TOKEN);