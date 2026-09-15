'use strict';

const assert = require('node:assert/strict');
const { test, after } = require('node:test');
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const dir = mkdtempSync(join(tmpdir(), 'gptjsbot-url-config-'));
process.env.SETTINGS_FILE = join(dir, 'base.json');
writeFileSync(process.env.SETTINGS_FILE, '{}');
const { loadSettings, validateHandlers } = require('../core/url-config');
const handlers = require('../handlers');
after(() => rmSync(dir, { recursive: true, force: true }));

let serial = 0;
function load(value) {
  const settingsFile = join(dir, `settings-${serial++}.json`);
  writeFileSync(settingsFile, typeof value === 'string' ? value : JSON.stringify(value));
  return loadSettings({ settingsFile });
}

test('absent optional file preserves existing targets and an explicit missing file fails', () => {
  const config = loadSettings({ settingsFile: '', projectRoot: dir });
  assert.equal(config.rules.instagram.targetHost, 'kkinstagram.com');
  assert.equal(config.rules.b23.targetHost, 'vxb23.tv');
  assert.equal(config.handlers.threads.enabled, true);
  assert.throws(() => loadSettings({ settingsFile: join(dir, 'missing.json') }), /ENOENT/);
  assert.throws(() => loadSettings({ settingsFile: dir }), /EISDIR/);
});

test('partial overrides retain omitted defaults and new rules keep query parameters by default', () => {
  const config = load({ urlConversion: {
    enabled: false,
    handlers: { threads: { enabled: false } },
    rules: {
      instagram: { targetHost: 'oginstagram.com', enabled: false },
      custom: { hosts: ['WWW.Source.Example', 'm.source.example'], targetHost: 'preview.example' },
    },
  } });
  assert.equal(config.enabled, false);
  assert.equal(config.handlers.threads.enabled, false);
  assert.equal(config.handlers.facebook.enabled, true);
  assert.deepEqual(config.rules.instagram.hosts, ['instagram.com']);
  assert.equal(config.rules.instagram.stripQuery, true);
  assert.equal(config.rules.instagram.enabled, false);
  assert.equal(config.rules.instagram.targetHost, 'oginstagram.com');
  assert.equal(config.rules.pixiv.targetHost, 'phixiv.net');
  assert.equal(config.rules.custom.stripQuery, false);
  assert.deepEqual(config.rules.custom.hosts, ['source.example', 'm.source.example']);
});

test('relative settings paths resolve against the project root', () => {
  writeFileSync(join(dir, 'relative.json'), JSON.stringify({ urlConversion: { enabled: false } }));
  assert.equal(loadSettings({ settingsFile: 'relative.json', projectRoot: dir }).enabled, false);
});

test('invalid settings report the offending field instead of silently using defaults', () => {
  const cases = [
    [null, /settings/],
    [{ urlConversion: null }, /urlConversion/],
    [{ urlConversion: { enabled: 'false' } }, /enabled/],
    [{ urlConversion: { rules: [] } }, /rules/],
    [{ urlConversion: { rules: { instagram: { targetHosts: 'typo.example' } } } }, /targetHosts/],
    [{ urlConversion: { rules: { custom: { hosts: [], targetHost: 'preview.example' } } } }, /hosts/],
    [{ urlConversion: { rules: { custom: { hosts: ['source.example'] } } } }, /targetHost/],
    [{ urlConversion: { rules: { instagram: { stripQuery: 'true' } } } }, /stripQuery/],
    [{ urlConversion: { rules: { instagram: { targetHost: 'instagram.com' } } } }, /來源和目標/],
    [{ urlConversion: { rules: { custom: { hosts: ['www.instagram.com'], targetHost: 'preview.example' } } } }, /重複/],
    ['{"urlConversion":{"rules":{"__proto__":{"hosts":["source.example"],"targetHost":"preview.example"}}}}', /名稱/],
  ];
  for (const [value, error] of cases) assert.throws(() => load(value), error);
  for (const targetHost of ['https://preview.example', 'preview.example/path', 'preview.example:443',
    'user@preview.example', 'preview.example?x=1', 'preview.example#hash', 'preview.example\\path', 'bad_host.example']) {
    assert.throws(() => load({ urlConversion: { rules: { instagram: { targetHost } } } }), /targetHost/);
  }
  assert.throws(() => load('{ "secret": "do-not-print", broken }'), err =>
    /JSON 格式錯誤/.test(err.message) && !err.message.includes('do-not-print'));
});

test('dedicated handlers reserve their names and source hosts even when disabled', () => {
  for (const host of ['x.com', 'twitter.com', 'www.facebook.com', 'fb.watch', 'threads.net', 'threads.com',
    'youtube.com', 'youtu.be', 'm.youtube.com', 'youtube-nocookie.com']) {
    const config = load({ urlConversion: { rules: {
      custom: { enabled: false, hosts: [host], targetHost: 'preview.example' },
    } } });
    assert.throws(() => validateHandlers(handlers, config), /專用處理器/);
  }
  assert.throws(() => validateHandlers(handlers, load({ urlConversion: { rules: {
    threads: { hosts: ['custom.example'], targetHost: 'preview.example' },
  } } })), /名稱.*重複/);
  assert.throws(() => validateHandlers(handlers, load({ urlConversion: { handlers: {
    unknown: { enabled: true },
  } } })), /未知的專用處理器/);
});
