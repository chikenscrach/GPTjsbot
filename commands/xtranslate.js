'use strict';

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getTwitterPreferences, setTwitterPreferences, resetTwitterPreferences } = require('../core/url-settings');
const { TWITTER_PROVIDERS, normalizeTwitterLanguage, twitterLanguageSuffix } = require('../utils/twitter');

const languages = [
  { name: '繁體中文', value: 'zh-hant' },
  { name: '簡體中文', value: 'zh-hans' },
  { name: '英文', value: 'en' },
  { name: '日文', value: 'ja' },
  { name: '韓文', value: 'ko' },
  { name: '關閉翻譯', value: 'off' },
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('xtranslate')
    .setDescription('設定自己分享 X 貼文時使用的翻譯語言與預覽服務')
    .addSubcommand(sub => sub.setName('set').setDescription('更改個人翻譯語言或預覽服務')
      .addStringOption(option => option.setName('language')
        .setDescription('選擇或輸入語言代碼，例如 zh-TW、en、ja。輸入 off 可關閉翻譯')
        .setMaxLength(20).setAutocomplete(true))
      .addStringOption(option => option.setName('provider').setDescription('X 連結轉換使用的服務')
        .addChoices(...TWITTER_PROVIDERS.map(host => ({ name: host, value: host })))))
    .addSubcommand(sub => sub.setName('status').setDescription('查看自己的 X 貼文預覽設定'))
    .addSubcommand(sub => sub.setName('reset').setDescription('清除個人設定，恢復使用 Bot 預設值')),

  async autocomplete(interaction) {
    const query = interaction.options.getFocused().trim().toLowerCase();
    const code = normalizeTwitterLanguage(query);
    const choices = languages.filter(({ name, value }) =>
      name.includes(query) || value.includes(query) || value === code);
    if (code && !choices.some(choice => choice.value === code)) choices.push({ name: code, value: code });
    return interaction.respond(choices);
  },

  async execute(interaction) {
    const reply = content => interaction.reply({ content, flags: MessageFlags.Ephemeral });
    const userId = interaction.user.id;
    const sub = interaction.options.getSubcommand();
    if (sub === 'set') {
      const input = interaction.options.getString('language');
      const provider = interaction.options.getString('provider');
      if (input === null && provider === null) return reply('請選擇翻譯語言或預覽服務。');
      const language = normalizeTwitterLanguage(input);
      if (input !== null && !language) return reply('請輸入語言代碼，例如 zh-TW、en、ja，或使用 off 關閉翻譯。');
      if (provider !== null && !TWITTER_PROVIDERS.includes(provider)) return reply('請從清單選擇預覽服務。');
      setTwitterPreferences(userId, provider, language);
    } else if (sub === 'reset') {
      resetTwitterPreferences(userId);
    }

    const { targetHost, language } = getTwitterPreferences(userId);
    const suffix = twitterLanguageSuffix(language, targetHost);
    const label = languages.find(choice => choice.value === language)?.name ?? language;
    const translation = suffix ? `翻譯成 ${label}（\`/${suffix}\`）` : '顯示原文';
    return reply(`${sub === 'reset' ? '已恢復預設。' : ''}你分享的 X 貼文會使用 \`${targetHost}\`，${translation}。`);
  },
};
