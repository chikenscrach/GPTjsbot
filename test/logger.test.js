'use strict';

const assert = require('node:assert/strict');
const { after, test } = require('node:test');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const {
  ChannelType,
  Collection,
  EmbedBuilder,
  Events,
  PermissionFlagsBits,
  PermissionsBitField,
} = require('discord.js');

const testDataDir = mkdtempSync(join(tmpdir(), 'gptjsbot-logger-test-'));
process.env.BOT_DATA_DIR = testDataDir;
delete process.env.LOGGER_PRESENCE_ENABLED;

const db = require('../core/db');
const logger = require('../core/logger');
const loggerCommand = require('../commands/logger');
const messageBulkDelete = require('../events/messageBulkDelete');
const messageUpdate = require('../events/messageUpdate');
const presenceUpdate = require('../events/presenceUpdate');

after(() => {
  db.close();
  rmSync(testDataDir, { recursive: true, force: true });
});

function enabledSettings(overrides = {}) {
  return {
    enabled: 1,
    log_presence: 1,
    log_message_delete: 1,
    log_message_update: 1,
    exclude_channels: '',
    exclude_bots: 1,
    ...overrides,
  };
}

function makeChannel({
  id = '200000000000000001',
  guildId = '100000000000000001',
  type = ChannelType.GuildText,
  permissions = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.EmbedLinks,
  ],
  sendable = true,
} = {}) {
  const permissionBits = new PermissionsBitField(permissions);
  return {
    id,
    guildId,
    name: 'logger-test',
    type,
    isSendable: () => sendable,
    permissionsFor: () => permissionBits,
    send: async () => undefined,
    toString: () => `<#${id}>`,
  };
}

function makeInteraction({
  guildId,
  subcommand,
  channel = makeChannel({ guildId }),
  eventKey = null,
  canManageGuild = true,
} = {}) {
  const replies = [];
  const guild = {
    id: guildId,
    members: { me: { id: 'bot-user' } },
    channels: {
      cache: new Collection([[channel.id, channel]]),
      fetch: async channelId => channelId === channel.id ? channel : null,
    },
  };
  const interaction = {
    guild,
    client: { user: { id: 'bot-user' } },
    memberPermissions: new PermissionsBitField(
      canManageGuild ? [PermissionFlagsBits.ManageGuild] : [],
    ),
    options: {
      getSubcommand: () => subcommand,
      getChannel: () => channel,
      getString: () => eventKey,
    },
    reply: async payload => {
      replies.push(payload);
      return payload;
    },
  };
  return { interaction, replies };
}

async function withPatchedLogger(patches, callback) {
  const originals = new Map();
  for (const [key, value] of Object.entries(patches)) {
    originals.set(key, logger[key]);
    logger[key] = value;
  }
  try {
    return await callback();
  } finally {
    for (const [key, value] of originals) logger[key] = value;
  }
}

function embedCharacterCount(embed) {
  const data = typeof embed.toJSON === 'function' ? embed.toJSON() : embed;
  return (data.title?.length || 0)
    + (data.description?.length || 0)
    + (data.author?.name?.length || 0)
    + (data.footer?.text?.length || 0)
    + (data.fields || []).reduce(
      (total, field) => total + field.name.length + field.value.length,
      0,
    );
}

test('truncate keeps the suffix inside the requested maximum', () => {
  assert.equal(logger.truncate('12345', 5), '12345');
  assert.equal(logger.truncate('', 5), '');
  assert.equal(logger.truncate(null, 5), '');

  const truncated = logger.truncate('a'.repeat(100), 20);
  assert.equal(truncated.length, 20);
  assert.match(truncated, /…\(已截斷\)$/);
});

test('describeContent reads Discord Collections for attachments and stickers', () => {
  const result = logger.describeContent({
    content: 'hello',
    attachments: new Collection([
      ['attachment', { id: 'attachment', url: 'https://example.test/file.png' }],
    ]),
    embeds: [{}],
    stickers: new Collection([
      ['sticker', { id: 'sticker', name: 'wave' }],
    ]),
  });

  assert.match(result, /hello/);
  assert.match(result, /https:\/\/example\.test\/file\.png/);
  assert.match(result, /Embed 數量：1/);
  assert.match(result, /wave \(sticker\)/);
  assert.equal(logger.describeContent({}), '(無文字內容)');
});

test('shouldIgnore respects direct, thread-parent, and category exclusions', () => {
  const guild = { channels: { cache: new Collection() } };
  const category = { id: 'category', parentId: null, guild };
  const forum = { id: 'forum', parentId: category.id, parent: category, guild };
  const thread = { id: 'thread', parentId: forum.id, parent: forum, guild };
  guild.channels.cache.set(category.id, category);
  guild.channels.cache.set(forum.id, forum);
  guild.channels.cache.set(thread.id, thread);

  const message = {
    channelId: thread.id,
    channel: thread,
    guild,
    author: { bot: false },
  };

  assert.equal(logger.shouldIgnore(enabledSettings({ exclude_channels: 'thread' }), 'delete', message), true);
  assert.equal(logger.shouldIgnore(enabledSettings({ exclude_channels: 'forum' }), 'delete', message), true);
  assert.equal(logger.shouldIgnore(enabledSettings({ exclude_channels: 'category' }), 'delete', message), true);
  assert.equal(logger.shouldIgnore(enabledSettings({ exclude_channels: 'elsewhere' }), 'delete', message), false);
  assert.equal(logger.shouldIgnore(enabledSettings({ enabled: 0 }), 'delete', message), true);
  assert.equal(logger.shouldIgnore(enabledSettings(), 'delete', { ...message, author: { bot: true } }), true);
});

test('message embeds mark unavailable partial content and ignore metadata-only updates', () => {
  const channel = {
    id: '200000000000000002',
    guildId: '100000000000000002',
    name: 'general',
  };
  const author = {
    id: '300000000000000002',
    tag: 'tester',
    displayAvatarURL: () => 'https://example.test/avatar.png',
  };
  const partial = {
    id: '400000000000000002',
    channelId: channel.id,
    channel,
    partial: true,
    attachments: new Collection(),
    embeds: [],
    stickers: new Collection(),
  };
  const current = {
    ...partial,
    partial: false,
    content: 'new content',
    author,
    guildId: channel.guildId,
  };

  const deleteFields = logger.buildMessageDeleteEmbed(partial).toJSON().fields;
  assert.match(deleteFields.find(field => field.name.includes('訊息內容')).value, /無法取得/);

  const update = logger.buildMessageUpdateEmbed(partial, current).toJSON();
  assert.match(update.fields.find(field => field.name.includes('修改前')).value, /無法取得/);
  assert.match(update.fields.find(field => field.name.includes('修改後')).value, /new content/);

  const sameBefore = { ...current, embeds: [] };
  const sameAfter = { ...current, embeds: [{}] };
  assert.equal(logger.buildMessageUpdateEmbed(sameBefore, sameAfter), null);

  const attachmentAfter = {
    ...current,
    attachments: new Collection([
      ['new-file', { id: 'new-file', url: 'https://example.test/new.png' }],
    ]),
  };
  assert.ok(logger.buildMessageUpdateEmbed(current, attachmentAfter));
});

test('presence builder accepts a partial user without a cached GuildMember', () => {
  const embed = logger.buildPresenceEmbed(null, {
    status: 'online',
    user: {
      id: '300000000000000003',
      username: 'partial-user',
      displayAvatarURL: () => 'https://example.test/avatar.png',
    },
    activities: [],
  });
  assert.ok(embed);
  assert.match(embed.toJSON().fields[0].value, /partial-user/);
});

test('updateSetting rejects unknown SQL identifiers', () => {
  assert.throws(
    () => logger.updateSetting('invalid-setting-guild', { 'enabled = 1': 1 }),
    /不允許更新/,
  );
});

test('sendLogs batches by both embed count and the 6000-character total', async () => {
  const guildId = 'send-logs-guild';
  const channel = makeChannel({ guildId, id: 'send-logs-channel' });
  const sends = [];
  channel.send = async payload => sends.push(payload);
  logger.updateSetting(guildId, { channel_id: channel.id, enabled: 1 });
  const client = { channels: { fetch: async () => channel } };

  await logger.sendLogs(
    client,
    guildId,
    Array.from({ length: 12 }, (_, index) => new EmbedBuilder().setDescription(`embed-${index}`)),
  );
  assert.deepEqual(sends.map(payload => payload.embeds.length), [10, 2]);

  sends.length = 0;
  await logger.sendLogs(
    client,
    guildId,
    Array.from({ length: 4 }, () => new EmbedBuilder().setDescription('x'.repeat(2000))),
  );
  assert.deepEqual(sends.map(payload => payload.embeds.length), [3, 1]);
  for (const payload of sends) {
    assert.ok(payload.embeds.length <= 10);
    assert.ok(payload.embeds.reduce((total, embed) => total + embedCharacterCount(embed), 0) <= 6000);
  }

  sends.length = 0;
  logger.updateSetting(guildId, { enabled: 0 });
  await logger.sendLogs(client, guildId, [new EmbedBuilder().setDescription('disabled')]);
  assert.equal(sends.length, 0);
});

test('logger command enforces runtime ManageGuild permission', async () => {
  const { interaction, replies } = makeInteraction({
    guildId: 'command-permission-guild',
    subcommand: 'status',
    canManageGuild: false,
  });
  await loggerCommand.execute(interaction);
  assert.match(replies[0].content, /管理伺服器/);
  assert.equal(
    loggerCommand.data.toJSON().default_member_permissions,
    PermissionFlagsBits.ManageGuild.toString(),
  );
});

test('set-channel and enable reject missing permissions, then accept a valid channel', async () => {
  const guildId = 'channel-validation-guild';
  const invalidChannel = makeChannel({
    guildId,
    id: 'invalid-log-channel',
    permissions: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
  });
  const invalid = makeInteraction({
    guildId,
    subcommand: 'set-channel',
    channel: invalidChannel,
  });
  await loggerCommand.execute(invalid.interaction);
  assert.match(invalid.replies[0].content, /嵌入連結/);
  assert.equal(logger.getSettings(guildId).channel_id, null);

  const validChannel = makeChannel({ guildId, id: 'valid-log-channel' });
  const valid = makeInteraction({
    guildId,
    subcommand: 'set-channel',
    channel: validChannel,
  });
  await loggerCommand.execute(valid.interaction);
  assert.equal(logger.getSettings(guildId).channel_id, validChannel.id);

  const enable = makeInteraction({
    guildId,
    subcommand: 'enable',
    channel: validChannel,
  });
  await loggerCommand.execute(enable.interaction);
  assert.equal(logger.getSettings(guildId).enabled, 1);
});

test('status remains within Embed limits with 500 excluded channels', async () => {
  const guildId = 'status-limit-guild';
  const excluded = Array.from(
    { length: 500 },
    (_, index) => String(10000000000000000000n + BigInt(index)),
  );
  logger.updateSetting(guildId, { exclude_channels: excluded.join(',') });
  const { interaction, replies } = makeInteraction({ guildId, subcommand: 'status' });
  await loggerCommand.execute(interaction);

  const embed = replies[0].embeds[0].toJSON();
  assert.ok(embed.fields.length <= 25);
  assert.ok(embed.fields.every(field => field.value.length <= 1024));
  assert.match(embed.fields.at(-1).name, /500/);
  assert.ok(embedCharacterCount(embed) <= 6000);
});

test('presence can be disabled while unavailable but cannot be enabled', async () => {
  const guildId = 'presence-toggle-guild';
  delete process.env.LOGGER_PRESENCE_ENABLED;
  logger.updateSetting(guildId, { log_presence: 1 });

  const disable = makeInteraction({
    guildId,
    subcommand: 'toggle',
    eventKey: 'log_presence',
  });
  await loggerCommand.execute(disable.interaction);
  assert.equal(logger.getSettings(guildId).log_presence, 0);

  const enable = makeInteraction({
    guildId,
    subcommand: 'toggle',
    eventKey: 'log_presence',
  });
  await loggerCommand.execute(enable.interaction);
  assert.match(enable.replies[0].content, /目前不可用/);
  assert.equal(logger.getSettings(guildId).log_presence, 0);
});

test('messageUpdate fetches only the new partial before filtering and logging', async () => {
  let oldFetchCalled = false;
  let sent = false;
  const guild = { id: 'event-update-guild', client: {} };
  const channel = { id: 'event-update-channel', guildId: guild.id, guild };
  const author = { id: 'event-user', tag: 'event-user', bot: false };
  const oldMessage = {
    id: 'event-message',
    partial: true,
    guild,
    channel,
    channelId: channel.id,
    fetch: async () => {
      oldFetchCalled = true;
      throw new Error('oldMessage.fetch must not run');
    },
  };
  const fetchedNewMessage = {
    ...oldMessage,
    partial: false,
    content: 'updated',
    author,
    client: {},
    attachments: new Collection(),
    embeds: [],
    stickers: new Collection(),
  };
  const incomingNewMessage = {
    ...oldMessage,
    fetch: async () => fetchedNewMessage,
  };

  await withPatchedLogger({
    getSettings: () => enabledSettings(),
    shouldIgnore: (_settings, _event, message, user) => {
      assert.equal(message, fetchedNewMessage);
      assert.equal(user, author);
      return false;
    },
    buildMessageUpdateEmbed: (oldValue, newValue) => {
      assert.equal(oldValue, oldMessage);
      assert.equal(newValue, fetchedNewMessage);
      return new EmbedBuilder().setDescription('update');
    },
    sendLog: async () => { sent = true; },
  }, async () => messageUpdate.execute(oldMessage, incomingNewMessage));

  assert.equal(oldFetchCalled, false);
  assert.equal(sent, true);
});

test('presenceUpdate resolves a partial user before applying the bot exclusion', async () => {
  const previousValue = process.env.LOGGER_PRESENCE_ENABLED;
  process.env.LOGGER_PRESENCE_ENABLED = 'true';
  let fetched = false;
  let sent = false;
  const partialUser = { id: 'presence-bot', partial: true };
  const guild = { id: 'presence-event-guild', client: {} };
  const presence = {
    guild,
    user: partialUser,
    status: 'online',
    activities: [],
    client: {
      users: {
        fetch: async userId => {
          fetched = true;
          assert.equal(userId, partialUser.id);
          return { id: userId, bot: true, partial: false };
        },
      },
    },
  };

  try {
    await withPatchedLogger({
      getSettings: () => enabledSettings({ exclude_bots: 1 }),
      buildPresenceEmbed: () => {
        throw new Error('bot presence must be ignored before building');
      },
      sendLog: async () => { sent = true; },
    }, async () => presenceUpdate.execute(null, presence));
  } finally {
    if (previousValue === undefined) delete process.env.LOGGER_PRESENCE_ENABLED;
    else process.env.LOGGER_PRESENCE_ENABLED = previousValue;
  }

  assert.equal(fetched, true);
  assert.equal(sent, false);
});

test('bulk delete builds all eligible embeds and calls sendLogs once', async () => {
  assert.equal(messageBulkDelete.name, Events.MessageBulkDelete);
  const guild = { id: 'bulk-delete-guild', client: {} };
  const channel = { id: 'bulk-channel', guild, client: {} };
  const messages = new Collection([
    ['one', { id: 'one', guild, channel, channelId: channel.id, author: { bot: false } }],
    ['two', { id: 'two', guild, channel, channelId: channel.id, author: { bot: false } }],
  ]);
  let calls = 0;

  await withPatchedLogger({
    getSettings: () => enabledSettings(),
    shouldIgnore: () => false,
    buildMessageDeleteEmbed: message => new EmbedBuilder().setDescription(message.id),
    sendLogs: async (_client, guildId, embeds) => {
      calls += 1;
      assert.equal(guildId, guild.id);
      assert.equal(embeds.length, 2);
    },
  }, async () => messageBulkDelete.execute(messages, channel));

  assert.equal(calls, 1);
});
