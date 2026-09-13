'use strict';

const assert = require('node:assert/strict');
const { after, test } = require('node:test');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const {
  ApplicationCommandType,
  ButtonStyle,
  ComponentType,
  InteractionContextType,
  MessageFlags,
  MessageReferenceType,
  MessageType,
  PermissionFlagsBits,
  PermissionsBitField,
} = require('discord.js');

const testDataDir = mkdtempSync(join(tmpdir(), 'gptjsbot-delete-threads-test-'));
process.env.BOT_DATA_DIR = testDataDir;
const db = require('../core/db');
const store = require('../core/threads-messages');
const command = require('../commands/delete-threads');

after(() => {
  db.close();
  rmSync(testDataDir, { recursive: true, force: true });
});

const THREADS_URL = 'https://www.threads.com/@example.user/post/Post123';
let nextId = 1000;

function makeFixture({
  stored = true,
  userId = 'owner',
  permissions = [],
  targetOverrides = {},
  sourceOverrides = {},
  fetchError = null,
  deleteError = null,
} = {}) {
  const calls = [];
  const source = {
    id: String(nextId++),
    guildId: 'guild',
    channelId: 'channel',
    author: { id: 'owner' },
    delete: async () => assert.fail('must not delete the original message'),
    suppressEmbeds: async () => assert.fail('must not change the original preview'),
    ...sourceOverrides,
  };
  const target = {
    id: String(nextId++),
    author: { id: 'bot', bot: true },
    guildId: 'guild',
    channelId: 'channel',
    type: MessageType.Reply,
    reference: {
      messageId: source.id,
      guildId: 'guild',
      channelId: 'channel',
      type: MessageReferenceType.Default,
    },
    embeds: [{ footer: { text: 'Threads' }, url: THREADS_URL }],
    components: [],
    delete: async () => {
      calls.push(['delete', target.id]);
      if (deleteError) throw deleteError;
    },
    ...targetOverrides,
  };
  const interaction = {
    client: { user: { id: 'bot' } },
    guildId: 'guild',
    channelId: 'channel',
    targetId: target.id,
    targetMessage: target,
    user: { id: userId },
    memberPermissions: new PermissionsBitField(permissions),
    channel: {
      messages: {
        fetch: async options => {
          calls.push(['fetch', options]);
          if (fetchError) throw fetchError;
          return source;
        },
      },
    },
    deferReply: async payload => calls.push(['defer', payload]),
    editReply: async payload => {
      calls.push(['reply', payload]);
      return payload;
    },
  };
  if (stored) store.recordThreadsMessage(target, source);
  return {
    source,
    target,
    interaction,
    calls,
    record: () => store.getThreadsMessage(target.id, source.guildId, source.channelId),
    replyText: () => calls.filter(([type]) => type === 'reply').at(-1)?.[1].content,
    setDeleteError: error => { deleteError = error; },
  };
}

function assertDeferred(fixture) {
  assert.deepEqual(fixture.calls[0], ['defer', { flags: MessageFlags.Ephemeral }]);
}

function assertNotDeleted(fixture) {
  assert.equal(fixture.calls.some(([type]) => type === 'delete'), false);
  assert.match(fixture.replyText(), /❌|❗/);
}

test('message context command is available to ordinary guild members', () => {
  const data = command.data.toJSON();
  assert.equal(data.name, '刪除 Threads 訊息');
  assert.equal(data.type, ApplicationCommandType.Message);
  assert.deepEqual(data.contexts, [InteractionContextType.Guild]);
  assert.equal(data.default_member_permissions, undefined);
});

test('original sender deletes only the selected tracked message even after source deletion', async () => {
  const fixture = makeFixture({ fetchError: { code: 10008 } });
  const otherMessage = { id: String(nextId++) };
  store.recordThreadsMessage(otherMessage, fixture.source);
  await command.execute(fixture.interaction);
  assertDeferred(fixture);
  assert.deepEqual(fixture.calls.filter(([type]) => type === 'delete'), [['delete', fixture.target.id]]);
  assert.equal(fixture.calls.some(([type]) => type === 'fetch'), false);
  assert.equal(fixture.record(), undefined);
  assert.ok(store.getThreadsMessage(otherMessage.id, 'guild', 'channel'));
  assert.match(fixture.replyText(), /已刪除/);
});

test('tracked standalone attachment can be deleted by its original sender', async () => {
  const fixture = makeFixture({
    targetOverrides: { type: MessageType.Default, reference: null, embeds: [], content: '📎 其他媒體：' },
  });
  await command.execute(fixture.interaction);
  assert.equal(fixture.record(), undefined);
  assert.match(fixture.replyText(), /已刪除/);
});

for (const permissions of [[], [PermissionFlagsBits.ManageGuild]]) {
  test(`another member cannot delete tracked media with permissions ${permissions}`, async () => {
    const fixture = makeFixture({ userId: 'another-member', permissions });
    await command.execute(fixture.interaction);
    assertDeferred(fixture);
    assertNotDeleted(fixture);
    assert.ok(fixture.record());
    assert.match(fixture.replyText(), /只有原始發文者/);
  });
}

for (const permission of [PermissionFlagsBits.ManageMessages, PermissionFlagsBits.Administrator]) {
  test(`channel moderator permission ${permission} allows deleting another sender's media`, async () => {
    const fixture = makeFixture({ userId: 'moderator', permissions: [permission] });
    await command.execute(fixture.interaction);
    assert.equal(fixture.record(), undefined);
    assert.match(fixture.replyText(), /已刪除/);
  });
}

test('guild permissions do not override missing channel ManageMessages permission', async () => {
  const fixture = makeFixture({ userId: 'another-member' });
  fixture.interaction.member = { permissions: new PermissionsBitField(PermissionFlagsBits.ManageMessages) };
  await command.execute(fixture.interaction);
  assertNotDeleted(fixture);
});

for (const [label, overrides] of [
  ['user message', { author: { id: 'owner', bot: false } }],
  ['different bot', { author: { id: 'another-bot', bot: true } }],
  ['webhook', { webhookId: 'webhook' }],
  ['interaction response', { interactionMetadata: { id: 'interaction' } }],
  ['legacy interaction response', { interaction: { id: 'interaction' } }],
  ['different guild', { guildId: 'another-guild' }],
  ['different channel', { channelId: 'another-channel' }],
]) {
  test(`rejects ${label} even if a record and moderator permissions exist`, async () => {
    const fixture = makeFixture({ permissions: [PermissionFlagsBits.Administrator], targetOverrides: overrides });
    await command.execute(fixture.interaction);
    assertNotDeleted(fixture);
    assert.ok(fixture.record());
  });
}

test('rejects a target that does not match the selected message ID', async () => {
  const fixture = makeFixture();
  fixture.interaction.targetId = 'different-message';
  await command.execute(fixture.interaction);
  assertNotDeleted(fixture);
});

test('rejects direct message context', async () => {
  const fixture = makeFixture();
  fixture.interaction.guildId = null;
  await command.execute(fixture.interaction);
  assertNotDeleted(fixture);
  assert.match(fixture.replyText(), /伺服器/);
});

test('a record from another guild or channel cannot authorize standalone media', async () => {
  for (const sourceOverrides of [{ guildId: 'other-guild' }, { channelId: 'other-channel' }]) {
    const fixture = makeFixture({
      sourceOverrides,
      targetOverrides: { reference: null, type: MessageType.Default, embeds: [] },
    });
    await command.execute(fixture.interaction);
    assertNotDeleted(fixture);
    assert.ok(fixture.record());
  }
});

test('legacy reply owner is resolved from the actual referenced Discord message', async () => {
  const fixture = makeFixture({ stored: false });
  await command.execute(fixture.interaction);
  assertDeferred(fixture);
  assert.deepEqual(fixture.calls[1], ['fetch', { message: fixture.source.id, force: true }]);
  assert.match(fixture.replyText(), /已刪除/);
});

test('legacy reply fetch rejects a different member even if the username matches', async () => {
  const fixture = makeFixture({ stored: false, userId: 'different-member' });
  fixture.source.author.username = 'same-name';
  fixture.interaction.user.username = 'same-name';
  await command.execute(fixture.interaction);
  assertNotDeleted(fixture);
});

test('legacy notice with original post link supports deletion by its sender', async () => {
  const fixture = makeFixture({
    stored: false,
    targetOverrides: {
      embeds: [],
      components: [{
        type: ComponentType.ActionRow,
        components: [{
          type: ComponentType.Button,
          style: ButtonStyle.Link,
          label: '開啟原文',
          url: 'https://threads.net/@example.user/post/Post123?xmt=tracking',
        }],
      }],
    },
  });
  await command.execute(fixture.interaction);
  assert.match(fixture.replyText(), /已刪除/);
});

test('legacy Threads footer with download warning is recognized', async () => {
  const fixture = makeFixture({
    stored: false,
    targetOverrides: { embeds: [{ footer: { text: 'Threads • 1 個媒體下載失敗' }, url: THREADS_URL }] },
  });
  await command.execute(fixture.interaction);
  assert.match(fixture.replyText(), /已刪除/);
});

test('legacy reply with a deleted source permits moderators but cannot establish ownership', async () => {
  const owner = makeFixture({ stored: false, fetchError: { code: 10008 } });
  await command.execute(owner.interaction);
  assertNotDeleted(owner);
  assert.match(owner.replyText(), /無法確認原始發文者/);

  const moderator = makeFixture({
    stored: false,
    userId: 'moderator',
    permissions: [PermissionFlagsBits.ManageMessages],
    fetchError: { code: 10008 },
  });
  await command.execute(moderator.interaction);
  assert.equal(moderator.calls.some(([type]) => type === 'fetch'), false);
  assert.match(moderator.replyText(), /已刪除/);
});

for (const [label, overrides] of [
  ['standalone extra', { type: MessageType.Default, reference: null, embeds: [], content: '📎 其他媒體：' }],
  ['ordinary bot reply', { embeds: [] }],
  ['unrelated footer', { embeds: [{ footer: { text: 'Threads user quote' }, url: THREADS_URL }] }],
  ['Threads profile link', { embeds: [{ footer: { text: 'Threads' }, url: 'https://www.threads.com/@example.user' }] }],
  ['spoofed domain', { embeds: [{ footer: { text: 'Threads' }, url: 'https://threads.com.example.test/@user/post/Code' }] }],
  ['credential URL', { embeds: [{ footer: { text: 'Threads' }, url: 'https://attacker@threads.com/@user/post/Code' }] }],
  ['missing URL', { embeds: [{ footer: { text: 'Threads' } }] }],
]) {
  test(`legacy ${label} is rejected even for a moderator`, async () => {
    const fixture = makeFixture({ stored: false, permissions: [PermissionFlagsBits.Administrator], targetOverrides: overrides });
    await command.execute(fixture.interaction);
    assertNotDeleted(fixture);
    assert.equal(fixture.calls.some(([type]) => type === 'fetch'), false);
  });
}

for (const [label, change] of [
  ['cross-channel reference', reference => { reference.channelId = 'another-channel'; }],
  ['cross-guild reference', reference => { reference.guildId = 'another-guild'; }],
  ['forward reference', reference => { reference.type = MessageReferenceType.Forward; }],
]) {
  test(`legacy ${label} cannot authorize deletion`, async () => {
    const fixture = makeFixture({ stored: false, permissions: [PermissionFlagsBits.Administrator] });
    change(fixture.target.reference);
    await command.execute(fixture.interaction);
    assertNotDeleted(fixture);
  });
}

for (const [key, value] of [['id', 'different-source'], ['guildId', 'different-guild'], ['channelId', 'different-channel']]) {
  test(`legacy source fetch must match referenced ${key}`, async () => {
    const fixture = makeFixture({ stored: false });
    fixture.source[key] = value;
    await command.execute(fixture.interaction);
    assertNotDeleted(fixture);
  });
}

test('failed deletion retains ownership so the sender can retry', async () => {
  const fixture = makeFixture({ deleteError: { code: 50013, message: 'Missing Permissions' } });
  await command.execute(fixture.interaction);
  assert.ok(fixture.record());
  assert.match(fixture.replyText(), /無法刪除/);

  fixture.setDeleteError(null);
  await command.execute(fixture.interaction);
  assert.equal(fixture.record(), undefined);
  assert.match(fixture.replyText(), /已刪除/);
});

test('already deleted target is benign and removes the stale ownership record', async () => {
  const fixture = makeFixture({ deleteError: { code: 10008 } });
  await command.execute(fixture.interaction);
  assert.equal(fixture.record(), undefined);
  assert.match(fixture.replyText(), /已經不存在/);
});

test('repeated deletion of a legacy-compatible tracked reply remains benign', async () => {
  const fixture = makeFixture();
  await command.execute(fixture.interaction);
  fixture.setDeleteError({ code: 10008 });
  await command.execute(fixture.interaction);
  assert.match(fixture.replyText(), /已經不存在/);
  assert.equal(fixture.record(), undefined);
});
