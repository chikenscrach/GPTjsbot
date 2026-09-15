'use strict';

const {
  SlashCommandBuilder, PermissionFlagsBits, InteractionContextType, MessageFlags, EmbedBuilder,
} = require('discord.js');
const settings = require('../core/url-settings');

const PAGE_SIZE = 8;

function targetOption(option) {
  return option.setName('target').setDescription('平台或自訂規則名稱')
    .setRequired(true).setAutocomplete(true);
}

function canManage(interaction) {
  const permissions = interaction.memberPermissions || interaction.member?.permissions;
  return Boolean((interaction.guildId || interaction.guild?.id)
    && permissions?.has?.(PermissionFlagsBits.ManageGuild));
}

function stateText(state) {
  return `${state.enabled ? '✅ 啟用' : '⏸️ 停用'}（${state.overridden ? '此伺服器設定' : '沿用預設'}）`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('url')
    .setDescription('管理此伺服器的網址轉換開關與查看規則')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(sub => sub.setName('enable').setDescription('開啟此伺服器的網址轉換總開關'))
    .addSubcommand(sub => sub.setName('disable').setDescription('關閉此伺服器的網址轉換總開關'))
    .addSubcommand(sub => sub.setName('toggle').setDescription('切換此伺服器的個別平台或規則')
      .addStringOption(targetOption))
    .addSubcommand(sub => sub.setName('reset').setDescription('讓個別平台或規則恢復跟隨預設開關')
      .addStringOption(targetOption))
    .addSubcommand(sub => sub.setName('status').setDescription('檢視總開關、個別狀態及轉換網址')
      .addIntegerOption(option => option.setName('page').setDescription('頁數').setMinValue(1))),

  async autocomplete(interaction) {
    if (!canManage(interaction)) return interaction.respond([]);
    const query = String(interaction.options.getFocused() || '').toLowerCase();
    const choices = settings.targets.filter(target =>
      [target.id, target.targetHost, ...(target.hosts || [])].some(value => value?.includes(query)))
      .slice(0, 25)
      .map(target => ({
        name: `${target.id} — ${target.kind === 'rule' ? target.targetHost : '專用處理器'}`.slice(0, 100),
        value: target.id,
      }));
    return interaction.respond(choices);
  },

  async execute(interaction) {
    const reply = content => interaction.reply({ content, flags: MessageFlags.Ephemeral });
    const guildId = interaction.guildId || interaction.guild?.id;
    if (!guildId) return reply('❗ 這個指令只能在伺服器中使用。');
    if (!canManage(interaction)) return reply('❌ 你需要「管理伺服器」權限才能使用這個指令。');

    const sub = interaction.options.getSubcommand();
    if (sub === 'enable' || sub === 'disable') {
      const state = settings.setMaster(guildId, sub === 'enable');
      return reply(`網址轉換總開關：${stateText(state)}。個別平台的開關設定會保留。`);
    }
    if (sub === 'toggle' || sub === 'reset') {
      const id = interaction.options.getString('target');
      // Autocomplete 只是建議清單，執行時仍須驗證手動輸入的名稱。
      if (!settings.targets.some(target => target.id === id)) {
        return reply('❌ 找不到這個平台或規則，請從建議清單選擇，或使用 `/url status` 查看。');
      }
      const state = sub === 'toggle' ? settings.toggleTarget(guildId, id) : settings.resetTarget(guildId, id);
      const masterNote = settings.getMaster(guildId).enabled ? '' : '\n目前總開關已關閉；可用 `/url enable` 開啟。';
      return reply(`**${id}**：${stateText(state)}。${masterNote}`);
    }
    if (sub === 'status') {
      const totalPages = Math.max(1, Math.ceil(settings.targets.length / PAGE_SIZE));
      const page = interaction.options.getInteger('page') ?? 1;
      if (!Number.isInteger(page) || page < 1 || page > totalPages) {
        return reply(`❌ 頁數必須介於 1 和 ${totalPages}。`);
      }
      const master = settings.getMaster(guildId);
      const embed = new EmbedBuilder().setColor(master.enabled ? 0x57f287 : 0x747f8d)
        .setTitle('🔗 網址轉換設定')
        .setDescription(`總開關：${stateText(master)}\n${master.enabled
          ? '以下設定只影響目前伺服器。' : '所有網址轉換暫停，以下保留個別平台的設定。'}`)
        .addFields(settings.targets.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map(target => {
          const detail = target.kind === 'rule'
            ? `\`${target.hosts.join(', ').slice(0, 180)}\` → \`${target.targetHost}\`\n查詢參數：${target.stripQuery ? '移除' : '保留'}`
            : '使用專用解析流程';
          return { name: target.id, value: `${stateText(settings.getTarget(guildId, target.id))}\n${detail}` };
        }))
        .setFooter({ text: `第 ${page} / ${totalPages} 頁 · ${settings.targets.length} 個平台／規則 · /url status page:頁數` });
      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
    return reply('❌ 未知的子指令。');
  },
};
