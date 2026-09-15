'use strict';

const assert = require('node:assert/strict');
const { after, test } = require('node:test');
const { mkdtempSync, readFileSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');
const { Collection, PermissionFlagsBits, PermissionsBitField, MessageFlags } = require('discord.js');

const dir = mkdtempSync(join(tmpdir(), 'gptjsbot-url-conversion-'));
const configPath = join(dir, 'settings.json');
const config = { urlConversion: { rules: {
  instagram: { targetHost: 'oginstagram.com' },
  custom: { hosts: ['source.example', 'm.source.example'], targetHost: 'preview.example' },
  hidden: { enabled: false, hosts: ['hidden.example'], targetHost: 'hidden-preview.example' },
  ...Object.fromEntries(Array.from({ length: 28 }, (_, n) => [`extra_${n}`, {
    hosts: [`source${n}.example`], targetHost: `preview${n}.example`,
  }])),
} } };
writeFileSync(configPath, JSON.stringify(config));
process.env.BOT_DATA_DIR = dir;
process.env.SETTINGS_FILE = configPath;
const db = require('../core/db');
const settings = require('../core/url-settings');
const command = require('../commands/url');
const simple = require('../handlers/simple');
const threads = require('../handlers/threads');
const event = require('../events/messageCreate');
const { handleCommandInteraction } = require('../core/command-interactions');

after(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

let serial = 0;
function source(content, guildId = `guild-${++serial}`) {
  const sent = [], suppressed = [];
  return {
    sent, suppressed,
    message: {
      content, guildId, id: `source-${++serial}`, channelId: 'channel', author: { id: 'author', bot: false },
      suppressEmbeds: async value => suppressed.push(value),
      channel: { send: async payload => {
        sent.push(payload);
        return { id: `sent-${++serial}`, guildId, channelId: 'channel' };
      } },
    },
  };
}

function interaction({ guildId = `guild-${++serial}`, sub = 'status', target = null, page = null,
  allowed = true, autocomplete = false, query = '' } = {}) {
  const replies = [], suggestions = [];
  return {
    replies, suggestions,
    value: {
      guildId,
      client: { commands: new Collection([['url', command]]) }, commandName: 'url',
      memberPermissions: new PermissionsBitField(allowed ? [PermissionFlagsBits.ManageGuild] : []),
      options: { getSubcommand: () => sub, getString: () => target, getInteger: () => page, getFocused: () => query },
      isAutocomplete: () => autocomplete, isChatInputCommand: () => !autocomplete, isMessageContextMenuCommand: () => false,
      reply: async payload => replies.push(payload), respond: async choices => suggestions.push(choices),
    },
  };
}

test('changed and new domains convert without changing handler code, preserving URL structure', async () => {
  const cases = [
    ['https://WWW.INSTAGRAM.COM/p/ABC/?utm_source=share#photo', 'https://oginstagram.com/p/ABC/#photo'],
    ['https://source.example/item%2F42?id=123&tag=a%20b#part', 'https://preview.example/item%2F42?id=123&tag=a%20b#part'],
    ['http://www.source.example/one', 'http://preview.example/one'],
    ['https://m.source.example/path', 'https://preview.example/path'],
    ['https://source.example/?next=https://source.example/path', 'https://preview.example/?next=https://source.example/path'],
  ];
  for (const [input, expected] of cases) {
    const fixture = source(input);
    await event.execute(fixture.message);
    assert.equal(fixture.sent[0].content, expected);
    assert.deepEqual(fixture.suppressed, [true]);
    assert.ok(db.prepare('SELECT 1 FROM threads_messages WHERE source_message_id = ?').get(fixture.message.id));
  }
  for (const input of ['https://source.example.evil.test/path', 'https://other.source.example/path',
    'https://evil.example/source.example', 'https://user:pass@source.example/path', 'https://source.example:8080/path',
    'ftp://source.example/path']) {
    assert.equal(await simple.resolve(input), null, input);
  }
  assert.equal(simple.match('constructor'), false);
});

test('guild toggles and reset respect file defaults without changing other guilds or the file', async () => {
  const guildId = 'toggle-guild';
  assert.deepEqual(settings.getTarget(guildId, 'hidden'), { enabled: false, overridden: false });
  let fixture = source('https://hidden.example/item', guildId);
  await event.execute(fixture.message);
  assert.equal(fixture.sent.length, 0);
  assert.deepEqual(settings.toggleTarget(guildId, 'hidden'), { enabled: true, overridden: true });
  fixture = source('https://hidden.example/item', guildId);
  await event.execute(fixture.message);
  assert.equal(fixture.sent[0].content, 'https://hidden-preview.example/item');
  assert.equal(settings.getTarget('another-guild', 'hidden').enabled, false);
  assert.deepEqual(settings.resetTarget(guildId, 'hidden'), { enabled: false, overridden: false });
  assert.throws(() => settings.toggleTarget(guildId, 'unknown'), /未知/);
  assert.throws(() => settings.toggleTarget(null, 'hidden'), /伺服器/);
  assert.equal(db.prepare('SELECT count(*) AS n FROM url_conversion_overrides WHERE guild_id = ?').get(guildId).n, 0);
  assert.deepEqual(JSON.parse(readFileSync(configPath, 'utf8')), config);
});

test('disabled dedicated handler is never invoked and mixed messages retain original previews', async t => {
  const guildId = 'mixed-guild';
  settings.toggleTarget(guildId, 'threads');
  t.mock.method(threads, 'resolve', async () => assert.fail('disabled handler must not fetch or resolve'));
  const fixture = source('https://threads.com/@alice/post/abc https://instagram.com/p/ABC/', guildId);
  await event.execute(fixture.message);
  assert.equal(fixture.sent.length, 1);
  assert.equal(fixture.sent[0].content, 'https://oginstagram.com/p/ABC/');
  assert.deepEqual(fixture.suppressed, []);
});

test('disabled simple rules preserve previews while other active rules still convert', async () => {
  const fixture = source('https://hidden.example/a https://source.example/b');
  await event.execute(fixture.message);
  assert.equal(fixture.sent[0].content, 'https://preview.example/b');
  assert.deepEqual(fixture.suppressed, []);
});

test('master disable skips all processing and enabling it preserves individual settings', async t => {
  const guildId = 'master-guild';
  settings.toggleTarget(guildId, 'instagram');
  settings.setMaster(guildId, false);
  t.mock.method(threads, 'resolve', async () => assert.fail('master disabled'));
  const fixture = source('https://threads.com/@alice/post/abc https://source.example/a', guildId);
  await event.execute(fixture.message);
  assert.equal(fixture.sent.length, 0);
  assert.deepEqual(fixture.suppressed, []);
  settings.setMaster(guildId, true);
  assert.equal(settings.getTarget(guildId, 'instagram').enabled, false);
  assert.equal(settings.getTarget(guildId, 'custom').enabled, true);
  assert.equal(settings.getMaster('unaffected-guild').enabled, true);
});

test('existing DM conversions use configured defaults without writing guild settings', async () => {
  const fixture = source('https://source.example/a', null);
  await event.execute(fixture.message);
  assert.equal(fixture.sent[0].content, 'https://preview.example/a');
  assert.equal(db.prepare('SELECT count(*) AS n FROM url_conversion_settings WHERE guild_id IS NULL').get().n, 0);
});

test('command permissions and runtime target validation prevent unauthorized changes', async () => {
  for (const sub of ['toggle', 'reset', 'enable', 'disable', 'status']) {
    const fixture = interaction({ guildId: 'blocked-guild', sub, target: 'instagram', allowed: false });
    await command.execute(fixture.value);
    assert.match(fixture.replies[0].content, /管理伺服器/);
    assert.equal(fixture.replies[0].flags, MessageFlags.Ephemeral);
  }
  const dm = interaction({ guildId: null, sub: 'toggle', target: 'instagram' });
  await command.execute(dm.value);
  assert.match(dm.replies[0].content, /只能在伺服器/);
  const unknown = interaction({ guildId: 'blocked-guild', sub: 'toggle', target: 'not-in-file' });
  await command.execute(unknown.value);
  assert.match(unknown.replies[0].content, /找不到/);
  assert.equal(db.prepare('SELECT count(*) AS n FROM url_conversion_overrides WHERE guild_id = ?').get('blocked-guild').n, 0);
  assert.equal(db.prepare('SELECT count(*) AS n FROM url_conversion_settings WHERE guild_id = ?').get('blocked-guild').n, 0);
});

test('slash commands toggle, reset, disable and enable with truthful effective status', async () => {
  const guildId = 'command-guild';
  for (const [sub, target] of [['disable', null], ['toggle', 'instagram']]) {
    const fixture = interaction({ guildId, sub, target });
    await handleCommandInteraction(fixture.value);
    assert.equal(fixture.replies[0].flags, MessageFlags.Ephemeral);
  }
  assert.equal(settings.getTarget(guildId, 'instagram').enabled, false);
  const reset = interaction({ guildId, sub: 'reset', target: 'instagram' });
  await command.execute(reset.value);
  assert.match(reset.replies[0].content, /沿用預設/);
  assert.match(reset.replies[0].content, /總開關已關閉/);
  assert.deepEqual(settings.getTarget(guildId, 'instagram'), { enabled: true, overridden: false });
  const enable = interaction({ guildId, sub: 'enable' });
  await command.execute(enable.value);
  assert.equal(settings.getMaster(guildId).enabled, true);
});

test('dynamic autocomplete includes custom and disabled rules without static choices', async () => {
  const data = command.data.toJSON();
  assert.equal(data.default_member_permissions, String(PermissionFlagsBits.ManageGuild));
  assert.deepEqual(data.contexts, [0]);
  const option = data.options.find(sub => sub.name === 'toggle').options[0];
  assert.equal(option.autocomplete, true);
  assert.equal(option.choices, undefined);
  for (const [query, expected] of [['source.example', 'custom'], ['hidden', 'hidden'], ['oginstagram', 'instagram'], ['threads', 'threads']]) {
    const fixture = interaction({ autocomplete: true, query });
    await handleCommandInteraction(fixture.value);
    assert.ok(fixture.suggestions[0].some(choice => choice.value === expected));
    assert.equal(fixture.replies.length, 0);
  }
  const all = interaction({ autocomplete: true });
  await handleCommandInteraction(all.value);
  assert.equal(all.suggestions[0].length, 25);
  const denied = interaction({ autocomplete: true, allowed: false });
  await handleCommandInteraction(denied.value);
  assert.deepEqual(denied.suggestions, [[]]);
});

test('status paginates every configured target within Discord embed limits', async () => {
  const ids = [];
  const pages = Math.ceil(settings.targets.length / 8);
  for (let page = 1; page <= pages; page++) {
    const fixture = interaction({ page });
    await command.execute(fixture.value);
    const embed = fixture.replies[0].embeds[0].toJSON();
    assert.ok(embed.fields.length <= 8);
    const chars = embed.title.length + embed.description.length + embed.footer.text.length
      + embed.fields.reduce((sum, field) => sum + field.name.length + field.value.length, 0);
    assert.ok(chars <= 6000);
    ids.push(...embed.fields.map(field => field.name));
  }
  assert.deepEqual(ids, settings.targets.map(target => target.id));
  const invalid = interaction({ page: pages + 1 });
  await command.execute(invalid.value);
  assert.match(invalid.replies[0].content, /頁數/);
});

test('guild settings survive process restart, target URL changes, and default changes', () => {
  const guildId = 'restart-guild';
  settings.toggleTarget(guildId, 'instagram');
  settings.toggleTarget(guildId, 'custom');
  settings.setMaster(guildId, false);
  const changedFile = join(dir, 'changed.json');
  writeFileSync(changedFile, JSON.stringify({ urlConversion: { rules: {
    instagram: { targetHost: 'new-preview.example' },
    custom: { enabled: false, hosts: ['source.example'], targetHost: 'other-preview.example' },
  } } }));
  const reader = spawnSync(process.execPath, ['-e', `
    const settings = require(${JSON.stringify(require.resolve('../core/url-settings'))});
    const db = require(${JSON.stringify(require.resolve('../core/db'))});
    const id = 'restart-guild';
    const result = {
      master: settings.getMaster(id), instagram: settings.getTarget(id, 'instagram'),
      targetHost: settings.requireTarget('instagram').targetHost,
      newGuild: settings.getTarget('new-guild', 'custom'),
      reset: settings.resetTarget(id, 'custom'),
    };
    process.stdout.write(JSON.stringify(result));
    db.close();
  `], { cwd: tmpdir(), env: { ...process.env, BOT_DATA_DIR: dir, SETTINGS_FILE: changedFile }, encoding: 'utf8' });
  assert.ifError(reader.error);
  assert.equal(reader.status, 0, reader.stderr);
  assert.deepEqual(JSON.parse(reader.stdout), {
    master: { enabled: false, overridden: true },
    instagram: { enabled: false, overridden: true },
    targetHost: 'new-preview.example',
    newGuild: { enabled: false, overridden: false },
    reset: { enabled: false, overridden: false },
  });
});

test('autocomplete failures use the autocomplete response and context commands keep their existing route', async t => {
  t.mock.method(console, 'error', () => {});
  const fixture = interaction({ autocomplete: true });
  fixture.value.client.commands.set('url', { autocomplete: async () => { throw new Error('failure'); } });
  await handleCommandInteraction(fixture.value);
  assert.deepEqual(fixture.suggestions, [[]]);
  assert.equal(fixture.replies.length, 0);

  const context = interaction();
  let executed = false;
  context.value.isChatInputCommand = () => false;
  context.value.isMessageContextMenuCommand = () => true;
  context.value.client.commands.set('url', { execute: async () => { executed = true; } });
  await handleCommandInteraction(context.value);
  assert.equal(executed, true);
});
