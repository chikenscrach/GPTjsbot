'use strict';

const assert = require('node:assert/strict');
const { after, test } = require('node:test');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');
const { Collection } = require('discord.js');

const testDataDir = mkdtempSync(join(tmpdir(), 'gptjsbot-message-create-'));
process.env.BOT_DATA_DIR = testDataDir;
const db = require('../core/db');
const threads = require('../handlers/threads');
const facebook = require('../handlers/facebook');
const event = require('../events/messageCreate');
const messageDelete = require('../events/messageDelete');
const messageBulkDelete = require('../events/messageBulkDelete');
const { getThreadsMessage } = require('../core/threads-messages');

after(() => {
  db.close();
  rmSync(testDataDir, { recursive: true, force: true });
});

let serial = 0;
function source(content = 'https://www.threads.com/@alice/post/one') {
  const id = `source-${++serial}`;
  const sent = [];
  const message = {
    id, content, guildId: 'guild', channelId: 'channel',
    author: { id: 'original-user', bot: false },
    suppressEmbeds: async () => {},
    channel: {
      send: async payload => {
        const result = { id: `${id}-reply-${sent.length}`, payload: { ...payload } };
        sent.push(result);
        return result;
      },
    },
  };
  return { message, sent };
}

function media(files = [], additionalMessages = []) {
  return { type: 'embed', embed: { description: 'Threads media' }, files, additionalMessages };
}

function assertOwned(sent, message) {
  assert.deepEqual(getThreadsMessage(sent.id, message.guildId, message.channelId), {
    message_id: sent.id,
    guild_id: message.guildId,
    channel_id: message.channelId,
    source_message_id: message.id,
    author_id: message.author.id,
  });
}

test('records the sender of main, merged overflow and handler media batches across restart', async t => {
  t.mock.method(threads, 'resolve', async () => media(
    Array.from({ length: 10 }, (_, i) => `attachment-${i}`),
    [{ files: ['extra-attachment'] }],
  ));
  const { message, sent } = source('https://www.threads.com/@alice/post/one https://threads.net/@alice/post/two');
  await event.execute(message);
  assert.equal(sent.length, 4);
  assert.deepEqual(sent.map(reply => reply.payload.files.length), [10, 10, 1, 1]);
  for (const reply of sent) assertOwned(reply, message);

  const reader = spawnSync(process.execPath, ['-e', `
    const db = require(${JSON.stringify(require.resolve('../core/db'))});
    process.stdout.write(JSON.stringify(db.prepare('SELECT * FROM threads_messages WHERE source_message_id = ?').all(process.argv[1])));
    db.close();
  `, message.id], { cwd: tmpdir(), env: { ...process.env, BOT_DATA_DIR: testDataDir }, encoding: 'utf8' });
  assert.ifError(reader.error);
  assert.equal(reader.status, 0, reader.stderr);
  const rows = JSON.parse(reader.stdout);
  assert.equal(rows.length, sent.length);
  assert.ok(rows.every(row => row.author_id === message.author.id));
});

test('records Threads notices without suppressing the original preview', async t => {
  t.mock.method(threads, 'resolve', async () => ({ type: 'notice', message: '網址錯誤或脆文已刪除' }));
  const { message, sent } = source();
  t.mock.method(message, 'suppressEmbeds', async () => assert.fail('notice must not suppress embeds'));
  await event.execute(message);
  assert.equal(sent.length, 1);
  assertOwned(sent[0], message);
});

test('records the successful attachment-free fallback, not failed sends', async t => {
  t.mock.method(threads, 'resolve', async () => media(['file']));
  t.mock.method(console, 'warn', () => {});
  const { message, sent } = source();
  const send = message.channel.send;
  t.mock.method(message.channel, 'send', async payload => {
    if (payload.files) throw new Error('attachment upload failed');
    return send(payload);
  });
  await event.execute(message);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].payload.files, undefined);
  assertOwned(sent[0], message);
});

test('a DB failure after a successful send does not resend the media', async t => {
  t.mock.method(threads, 'resolve', async () => media(['file']));
  t.mock.method(console, 'error', () => {});
  const { message, sent } = source();
  db.exec(`CREATE TEMP TRIGGER fail_threads_record BEFORE INSERT ON threads_messages BEGIN
    SELECT RAISE(FAIL, 'simulated database write failure');
  END;`);
  try {
    await event.execute(message);
    assert.equal(sent.length, 1);
    assert.equal(getThreadsMessage(sent[0].id, message.guildId, message.channelId), undefined);
  } finally {
    db.exec('DROP TRIGGER fail_threads_record');
  }
});

test('mixed URL replies track Threads content but not separate Facebook media', async t => {
  t.mock.method(threads, 'resolve', async () => media(['threads-file'], [{ files: ['threads-extra'] }]));
  t.mock.method(facebook, 'resolve', async () => media(
    Array.from({ length: 10 }, (_, i) => `facebook-file-${i}`), [{ files: ['facebook-extra'] }],
  ));
  const { message, sent } = source('https://www.threads.com/@alice/post/one https://www.facebook.com/posts/123');
  await event.execute(message);
  assert.equal(sent.length, 4);
  assertOwned(sent[0], message);
  assertOwned(sent[2], message);
  assert.deepEqual(sent[1].payload.files, ['facebook-file-9']);
  assert.equal(getThreadsMessage(sent[1].id, message.guildId, message.channelId), undefined);
  assert.equal(getThreadsMessage(sent[3].id, message.guildId, message.channelId), undefined);
});

test('unrelated conversions and DMs do not create Threads ownership records', async t => {
  t.mock.method(facebook, 'resolve', async () => media(['facebook-file']));
  t.mock.method(threads, 'resolve', async () => media(['threads-file']));
  for (const input of ['https://www.facebook.com/posts/123', 'https://www.threads.com/@alice/post/one']) {
    const { message, sent } = source(input);
    if (input.includes('threads.com')) message.guildId = null;
    await event.execute(message);
    assert.equal(sent.length, 1);
    assert.equal(db.prepare('SELECT * FROM threads_messages WHERE message_id = ?').get(sent[0].id), undefined);
  }
});

test('Discord deletion events remove records even when logger is disabled', async t => {
  t.mock.method(threads, 'resolve', async () => media(['main'], [{ files: ['extra'] }]));
  const { message, sent } = source();
  await event.execute(message);
  const guild = { id: message.guildId };
  await messageDelete.execute({ id: sent[0].id, guild });
  await messageBulkDelete.execute(new Collection([[sent[1].id, { id: sent[1].id, guild }]]), { guild });
  for (const reply of sent) {
    assert.equal(getThreadsMessage(reply.id, message.guildId, message.channelId), undefined);
  }
});

test('help renders message context commands without requiring a slash description', async () => {
  const help = require('../commands/help');
  const deleteThreads = require('../commands/delete-threads');
  let payload;
  await help.execute({
    client: { commands: new Collection([['help', help], ['delete-threads', deleteThreads]]) },
    reply: async value => { payload = value; },
  });
  const fields = payload.embeds[0].toJSON().fields;
  assert.equal(fields[0].name, `右鍵 → 應用程式 → ${deleteThreads.data.name}`);
  assert.ok(fields[0].value.includes('管理訊息'));
});
