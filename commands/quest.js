const { SlashCommandBuilder, MessageFlags } = require('discord.js');

// 資料來源（xGustavvo 的 discord-api-tracker）
const QUESTS_URL =
  'https://raw.githubusercontent.com/xGustavvo/discord-api-tracker/refs/heads/main/quests.json';
const FALLBACK_QUEST_URL =
  'https://raw.githubusercontent.com/xGustavvo/discord-api-tracker/refs/heads/main/quest.json';
const RESTRICTIONS_URL =
  'https://gist.githubusercontent.com/xGustavvo/3d08b7369eb34b50834815fd43176cae/raw';

// Discord 官方測試用任務，不列入結果與統計
const TEST_QUEST_IDS = [
  '1193992107035983872',
  '1417206015245418566',
  '1223393873447878656',
  '1276640451235156082',
  '1483951358322147380',
  '1519474065293967471',
];

// 任務類型對照表
const TASK_MAP = {
  WATCH_VIDEO: '觀看影片',
  WATCH_VIDEO_ON_MOBILE: '手機觀看影片',
  PLAY_ON_DESKTOP: '桌面版遊玩',
  PLAY_ON_XBOX: 'Xbox 遊玩',
  PLAY_ON_PLAYSTATION: 'PlayStation 遊玩',
  PLAY_ACTIVITY: '遊玩活動',
  STREAM_ON_DESKTOP: '桌面版直播',
  win: '獲勝',
};

const REGION_FLAGS = {
  AT: ':flag_at:', AU: ':flag_au:', BE: ':flag_be:', BR: ':flag_br:',
  CA: ':flag_ca:', CH: ':flag_ch:', CN: ':flag_cn:', CZ: ':flag_cz:',
  DE: ':flag_de:', DK: ':flag_dk:', ES: ':flag_es:', FI: ':flag_fi:',
  FR: ':flag_fr:', HK: ':flag_hk:', HU: ':flag_hu:', IE: ':flag_ie:',
  IN: ':flag_in:', IT: ':flag_it:', JP: ':flag_jp:', KR: ':flag_kr:',
  MX: ':flag_mx:', NL: ':flag_nl:', NO: ':flag_no:', NZ: ':flag_nz:',
  PL: ':flag_pl:', PT: ':flag_pt:', SE: ':flag_se:', SG: ':flag_sg:',
  SK: ':flag_sk:', UK: ':flag_gb:', US: ':flag_us:', VN: ':flag_vn:',
};

/* ── 小工具 ── */

const toTimestamp = (iso) => {
  const t = Date.parse(iso);
  return isNaN(t) ? '?' : `<t:${Math.floor(t / 1000)}:R>`;
};

const getRewards = (q) =>
  q.config?.rewards_config?.rewards || q.config?.rewards || [];

const getTasks = (cfg) =>
  cfg?.task_config_v2?.tasks || cfg?.task_config?.tasks || {};

const taskName = (t) => {
  const type = t.type || t.event_name;
  if (type === 'ACHIEVEMENT_IN_ACTIVITY') return '活動成就';
  if (type === 'ACHIEVEMENT_IN_GAME') return '遊戲成就';
  return TASK_MAP[type] || type || '無';
};

const normalizeRegions = (regions) => {
  if (Array.isArray(regions)) return { type: 'include', list: regions };
  if (regions && typeof regions === 'object') {
    return {
      type: 'advanced',
      include: regions.include || [],
      exclude: regions.exclude || [],
    };
  }
  return null;
};

// 舊格式的任務資料沒有 config 欄位，統一轉成新格式
const normalizeQuest = (q) => {
  if (q.config) return q;
  return {
    id: q.id,
    config: {
      starts_at: q.starts_at,
      expires_at: q.expires_at,
      messages: {
        quest_name:
          q.messages?.quest_name || q.messages?.game_title || '未知任務',
      },
      task_config_v2: q.task_config_v2,
      rewards_config: q.rewards_config,
    },
  };
};

async function fetchQuestData() {
  const [res, fallbackRes, resRestrictions] = await Promise.all([
    fetch(QUESTS_URL),
    fetch(FALLBACK_QUEST_URL),
    fetch(RESTRICTIONS_URL),
  ]);

  const mainData = await res.json();
  const fallbackData = await fallbackRes.json();
  const restrictionsData = await resRestrictions.json();

  if (!Array.isArray(mainData)) return null;

  // 主要資料優先，缺少的再從備援資料補上
  const dataMap = new Map();
  for (const q of mainData) dataMap.set(q.id, normalizeQuest(q));
  if (Array.isArray(fallbackData)) {
    for (const q of fallbackData) {
      if (!dataMap.has(q.id)) dataMap.set(q.id, normalizeQuest(q));
    }
  }

  const restrictions = restrictionsData.quests || [];
  return {
    data: [...dataMap.values()],
    restrictions,
    restrictionsMap: new Map(restrictions.map((q) => [q.id, q])),
  };
}

/* ── 統計 ── */

function buildAllStats(data, now) {
  let total = 0;
  let active = 0;
  const typeCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  const uniqueRewards = { 1: new Set(), 2: new Set(), 3: new Set(), 4: new Set(), 5: new Set() };
  let totalOrbs = 0;
  const taskCount = {};

  for (const q of data) {
    const cfg = q.config;
    if (!cfg || TEST_QUEST_IDS.includes(q.id)) continue;
    total++;
    if (Date.parse(cfg?.expires_at || 0) > now) active++;

    const missionTypes = new Set();
    for (const r of getRewards(q)) {
      const t = r?.type;
      const sku = r?.sku_id;
      const quantity = r?.orb_quantity || 0;
      if (t >= 1 && t <= 5) missionTypes.add(t);
      if (t === 4 && quantity > 0) totalOrbs += quantity;
      if (t >= 1 && t <= 5 && sku) uniqueRewards[t].add(sku);
    }
    for (const t of missionTypes) typeCounts[t]++;

    for (const t of Object.values(getTasks(cfg))) {
      const name = taskName(t);
      taskCount[name] = (taskCount[name] || 0) + 1;
    }
  }

  const taskLines = Object.entries(taskCount)
    .sort((a, b) => b[1] - a[1])
    .map(([n, c]) => `- ${n}：**${c} 個任務**`)
    .join('\n');

  return [
    '**任務統計**',
    `任務總數：**${total}**`,
    `進行中任務：**${active}**`,
    '',
    '**獎勵類型：**',
    `Orb：**${typeCounts[4]} 個任務**（共 **${totalOrbs} Orbs**）`,
    `頭像裝飾：**${typeCounts[3]} 個任務**（**${uniqueRewards[3].size} 款裝飾**）`,
    `Nitro：**${typeCounts[5]} 個任務**`,
    `兌換碼：**${typeCounts[1]} 個任務**`,
    `遊戲內獎勵：**${typeCounts[2]} 個任務**`,
    '',
    '**任務類型：**',
    taskLines,
  ].join('\n');
}

function buildOrbStats(data, now) {
  const orbQuests = data.filter(
    (q) =>
      getRewards(q).some((r) => r.orb_quantity) &&
      !TEST_QUEST_IDS.includes(q.id)
  );
  const totalOrbs = orbQuests.reduce(
    (sum, q) => sum + (getRewards(q)[0]?.orb_quantity || 0),
    0
  );
  const activeQuests = orbQuests.filter(
    (q) => Date.parse(q.config?.expires_at) > now
  );
  const activeOrbs = activeQuests.reduce(
    (sum, q) => sum + (getRewards(q)[0]?.orb_quantity || 0),
    0
  );
  const orbGroups = {};
  for (const q of orbQuests) {
    const orbs = getRewards(q)[0]?.orb_quantity || 0;
    orbGroups[orbs] = (orbGroups[orbs] || 0) + 1;
  }

  const lines = [
    '**Orb 任務統計：**',
    `任務總數：${orbQuests.length}`,
    `Orb 總數：${totalOrbs}`,
    '',
    `目前進行中任務：${activeQuests.length}`,
    `目前可取得 Orb：${activeOrbs}`,
    '',
  ];
  for (const [orb, count] of Object.entries(orbGroups).sort((a, b) => b[0] - a[0])) {
    lines.push(`${orb} Orbs：${count} 個任務`);
  }
  lines.push('\n部分任務可能有地區或其他限制。');
  return lines.join('\n');
}

/* ── 任務列表分頁 ── */

function buildQuestPages(filtered, restrictions, restrictionsMap, now) {
  const totalCount = filtered.length;
  const footerPreview = `*（第 000/000 頁 • 顯示第 000-000 筆，共 ${totalCount} 個任務）*`;
  const FOOTER_RESERVE = footerPreview.length + 20;

  const pages = [];
  let currentPage = [];
  let currentText = '';

  for (const q of filtered) {
    const cfg = q.config;
    const name = cfg?.messages?.quest_name || '未知名稱';
    const link = `https://discord.com/quests/${q.id}`;
    const start = toTimestamp(cfg?.starts_at);
    const end = toTimestamp(cfg?.expires_at);
    const reward =
      getRewards(q)[0]?.messages?.name || getRewards(q)[0]?.name || '無獎勵';

    let taskNames = Object.values(getTasks(cfg)).map(taskName).join(' / ');
    if (!taskNames) taskNames = '無';

    const isExpired = Date.parse(cfg?.expires_at) <= now;

    let restriction = restrictionsMap.get(q.id);
    if (!restriction || !restriction.regions?.length) {
      const linked = restrictions.find((r) => r.replacement_id === q.id);
      if (linked) restriction = linked;
    }

    const ageRestricted = restriction?.show_age_gate === true;
    const isLinked =
      restriction?.replacement_id ||
      restrictions.some((r) => r.replacement_id === q.id);

    const regionsLines = [];
    const normalizedR = normalizeRegions(restriction?.regions);

    if (restriction?.is_global === false && normalizedR) {
      if (normalizedR.type === 'include') {
        const list = normalizedR.list.map((r) => REGION_FLAGS[r] || r).join(', ');
        regionsLines.push(`包含：${list}`);
      }
      if (normalizedR.type === 'advanced') {
        const inc = normalizedR.include || [];
        const exc = normalizedR.exclude || [];
        if (inc.length)
          regionsLines.push(`包含：${inc.map((r) => REGION_FLAGS[r] || r).join(', ')}`);
        if (exc.length)
          regionsLines.push(`排除：${exc.map((r) => REGION_FLAGS[r] || r).join(', ')}`);
      }
    }

    const questText =
      (isExpired ? `- **${name}**` : `- [**${name}**](<${link}>)`) +
      `\n開始：${start} | 結束：${end}` +
      `\n獎勵：${reward}` +
      `\n任務：${taskNames}` +
      (ageRestricted ? '\n年齡限制：🔞' : '') +
      (regionsLines.length ? `\n地區限制：\n${regionsLines.join('\n')}` : '') +
      (isLinked ? '\n連動任務：🔗' : '');

    if (
      currentPage.length >= 10 ||
      (currentText + '\n\n' + questText).length > 2000 - FOOTER_RESERVE
    ) {
      pages.push(currentPage);
      currentPage = [];
      currentText = '';
    }

    currentPage.push(questText);
    currentText += (currentText ? '\n\n' : '') + questText;
  }

  if (currentPage.length) pages.push(currentPage);
  return pages;
}

function renderPage(pages, page, totalCount) {
  const totalPages = pages.length;
  if (page > totalPages)
    return `❌ 第 ${page} 頁不存在，最多只有 ${totalPages} 頁。`;

  const pageItems = pages[page - 1];
  let shownBefore = 0;
  for (let i = 0; i < page - 1; i++) shownBefore += pages[i].length;

  const start = shownBefore + 1;
  const end = shownBefore + pageItems.length;

  return (
    pageItems.join('\n\n') +
    `\n\n*（第 ${page}/${totalPages} 頁 • 顯示第 ${start}-${end} 筆，共 ${totalCount} 個任務）*`
  );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('quest')
    .setDescription('查詢 Discord 任務（Quest）資訊')
    .addSubcommand((sub) =>
      sub
        .setName('list')
        .setDescription('顯示任務列表（預設為進行中的任務，由新到舊排序）')
        .addIntegerOption((o) =>
          o.setName('page').setDescription('頁數').setMinValue(1))
        .addBooleanOption((o) =>
          o.setName('expired').setDescription('包含已過期的任務'))
        .addBooleanOption((o) =>
          o.setName('expiring').setDescription('改依到期時間排序（最快到期的在前）'))
        .addStringOption((o) =>
          o
            .setName('filter')
            .setDescription('進階篩選')
            .addChoices(
              { name: '僅顯示有限制的任務', value: 'restricted' },
              { name: '僅顯示有地區限制的任務', value: 'regions' },
              { name: '僅顯示有年齡限制的任務', value: 'age' },
              { name: '僅顯示連動任務', value: 'linked' },
            )))
    .addSubcommand((sub) =>
      sub
        .setName('search')
        .setDescription('搜尋任務（名稱、獎勵、ID 或月份，擇一填寫）')
        .addStringOption((o) =>
          o.setName('name').setDescription('依名稱搜尋（包含已過期）'))
        .addStringOption((o) =>
          o.setName('reward').setDescription('依獎勵名稱搜尋'))
        .addStringOption((o) =>
          o.setName('id').setDescription('依任務 ID 搜尋'))
        .addStringOption((o) =>
          o.setName('month').setDescription('依開始月份搜尋，格式 MM/YY（例如 07/26，包含已過期）'))
        .addIntegerOption((o) =>
          o.setName('page').setDescription('頁數').setMinValue(1))
        .addBooleanOption((o) =>
          o.setName('expired').setDescription('包含已過期的任務（僅適用於獎勵與 ID 搜尋）')))
    .addSubcommand((sub) =>
      sub
        .setName('stats')
        .setDescription('顯示任務統計')
        .addStringOption((o) =>
          o
            .setName('type')
            .setDescription('統計類型')
            .setRequired(true)
            .addChoices(
              { name: '全部統計', value: 'all' },
              { name: 'Orb 統計', value: 'orbs' },
            ))),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'search') {
      const hasCriteria = ['name', 'reward', 'id', 'month'].some(
        (n) => interaction.options.getString(n)
      );
      if (!hasCriteria) {
        await interaction.reply({
          content: '❌ 請至少填寫一個搜尋條件（名稱、獎勵、ID 或月份）。',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    }

    await interaction.deferReply();

    let questData;
    try {
      questData = await fetchQuestData();
    } catch (e) {
      console.error('[quest] 取得任務資料失敗：', e);
      await interaction.editReply('❌ 取得或處理任務資料時發生錯誤。');
      return;
    }
    if (!questData) {
      await interaction.editReply('❌ 任務資料格式不正確。');
      return;
    }

    const { data, restrictions, restrictionsMap } = questData;
    const now = Date.now();

    /* ── 統計 ── */

    if (sub === 'stats') {
      const type = interaction.options.getString('type');
      await interaction.editReply(
        type === 'orbs' ? buildOrbStats(data, now) : buildAllStats(data, now)
      );
      return;
    }

    /* ── 篩選 ── */

    const page = interaction.options.getInteger('page') || 1;
    const showExpired = interaction.options.getBoolean('expired') || false;

    let filtered = data.filter((q) => !TEST_QUEST_IDS.includes(q.id));
    // 名稱與月份搜尋固定包含已過期任務（與原版行為一致）
    let alwaysIncludeExpired = false;

    if (sub === 'search') {
      const name = interaction.options.getString('name');
      const reward = interaction.options.getString('reward');
      const id = interaction.options.getString('id');
      const month = interaction.options.getString('month');

      if (id) {
        filtered = filtered.filter((q) => q.id === id.trim());
      } else if (name) {
        const keyword = name.toLowerCase();
        filtered = filtered.filter((q) =>
          q.config?.messages?.quest_name?.toLowerCase().includes(keyword)
        );
        alwaysIncludeExpired = true;
      } else if (reward) {
        const keyword = reward.toLowerCase();
        filtered = filtered.filter((q) =>
          getRewards(q).some((r) =>
            (r.messages?.name || r.name)?.toLowerCase().includes(keyword)
          )
        );
      } else if (month) {
        const [m, y] = month.split('/').map(Number);
        if (!m || !y) {
          await interaction.editReply('❌ 月份格式請使用 `MM/YY`（例如 `07/26`）。');
          return;
        }
        filtered = filtered.filter((q) => {
          const d = new Date(q.config?.starts_at);
          return d.getMonth() + 1 === m && d.getFullYear() === 2000 + y;
        });
        alwaysIncludeExpired = true;
      }
    }

    /* ── 排序 ── */

    const showExpiring =
      sub === 'list' && (interaction.options.getBoolean('expiring') || false);

    filtered = filtered.sort((a, b) => {
      if (showExpiring) {
        return (
          Date.parse(a.config?.expires_at || 0) -
          Date.parse(b.config?.expires_at || 0)
        );
      }
      return (
        Date.parse(b.config?.starts_at || 0) -
        Date.parse(a.config?.starts_at || 0)
      );
    });

    /* ── 限制篩選 ── */

    const filter = sub === 'list' ? interaction.options.getString('filter') : null;

    if (filter === 'restricted') {
      filtered = filtered.filter((q) => {
        let r = restrictionsMap.get(q.id);
        if (!r) r = restrictions.find((x) => x.replacement_id === q.id);
        return !!r;
      });
    } else if (filter === 'regions') {
      // regions 有陣列與 {include, exclude} 兩種格式，統一正規化後再判斷
      filtered = filtered.filter((q) => {
        let r = restrictionsMap.get(q.id);
        if (!r) r = restrictions.find((x) => x.replacement_id === q.id);
        if (!r || r.is_global !== false) return false;
        const nr = normalizeRegions(r.regions);
        if (!nr) return false;
        if (nr.type === 'include') return nr.list.length > 0;
        return nr.include.length > 0 || nr.exclude.length > 0;
      });
    } else if (filter === 'age') {
      filtered = filtered.filter((q) => {
        let r = restrictionsMap.get(q.id);
        if (!r) r = restrictions.find((x) => x.replacement_id === q.id);
        return r?.show_age_gate === true;
      });
    } else if (filter === 'linked') {
      filtered = filtered.filter((q) => {
        const r = restrictionsMap.get(q.id);
        return (
          r?.replacement_id ||
          restrictions.some((x) => x.replacement_id === q.id)
        );
      });
    }

    /* ── 過期篩選 ── */

    if (!alwaysIncludeExpired) {
      filtered = filtered.filter((q) => {
        const exp = Date.parse(q.config?.expires_at);
        if (isNaN(exp)) return false;
        if (!showExpired && exp <= now) return false;
        return true;
      });
    }

    if (!filtered.length) {
      await interaction.editReply('❌ 找不到任何任務。');
      return;
    }

    const pages = buildQuestPages(filtered, restrictions, restrictionsMap, now);
    await interaction.editReply(renderPage(pages, page, filtered.length));
  },
};
