const { GatewayIntentBits, Partials } = require('discord.js');

function isEnvFlagEnabled(name, env = process.env) {
  return /^(true|1|yes|on)$/i.test(String(env[name] || '').trim());
}

/**
 * 建立 Discord Client 的 Gateway intents 與 partials。
 *
 * Presence 與成員事件依部署環境明確 opt in；語音頻道狀態使用 standard
 * intent，固定啟用後仍由每個 guild 的 Logger 設定決定是否寫出日誌。
 */
function buildClientOptions(env = process.env) {
  const presenceLoggingEnabled = isEnvFlagEnabled('LOGGER_PRESENCE_ENABLED', env);
  const membersLoggingEnabled = isEnvFlagEnabled('LOGGER_MEMBERS_ENABLED', env);

  const intents = [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ];
  const partials = [Partials.Message, Partials.Channel];

  // GuildMembers 是 privileged intent。成員加入／離開或 presence 任一功能
  // 啟用時才要求，避免 Portal 尚未授權時以 4014 斷線。
  if (membersLoggingEnabled || presenceLoggingEnabled) {
    intents.push(GatewayIntentBits.GuildMembers);
    partials.push(Partials.User, Partials.GuildMember);
  }

  // GuildPresences 只供 presence 日誌使用，同樣必須由部署者明確 opt in。
  if (presenceLoggingEnabled) intents.push(GatewayIntentBits.GuildPresences);

  return { intents, partials };
}

module.exports = {
  buildClientOptions,
  isEnvFlagEnabled,
};
