require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client, Collection, GatewayIntentBits } = require('discord.js');

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
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

// Bot 啟動事件
client.once('ready', () => {
  console.log(`🤖 Bot 上線：${client.user.tag}`);
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
