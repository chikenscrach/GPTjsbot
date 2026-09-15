'use strict';

const fs = require('node:fs');
const path = require('node:path');

const PROJECT_ROOT = path.join(__dirname, '..');
const RESERVED_IDS = new Set(['simple', '__proto__', 'prototype', 'constructor']);

function object(value, location) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${location} 必須是物件`);
  }
  return value;
}

function keys(value, allowed, location) {
  object(value, location);
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new Error(`${location}.${key} 是未知設定`);
  }
}

function boolean(value, location) {
  if (typeof value !== 'boolean') throw new Error(`${location} 必須是 true 或 false`);
  return value;
}

function validateId(id, location) {
  if (!/^[a-z][a-z0-9_-]{0,31}$/.test(id) || RESERVED_IDS.has(id)) {
    throw new Error(`${location}.${id} 名稱必須以小寫字母開頭，限 32 字元的小寫字母、數字、_、-`);
  }
}

// 與所有處理器共用來源網域的正規化方式；不擴大匹配到任意子網域。
function normalizeHostname(hostname) {
  return hostname.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
}

function domain(value, location, source = false) {
  if (typeof value !== 'string' || !value || /[\s/:?#@\\]/u.test(value)) {
    throw new Error(`${location} 只能填網域，不可包含協定、路徑、連接埠或參數`);
  }
  let hostname;
  try {
    hostname = new URL(`https://${value}`).hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    throw new Error(`${location} 不是有效網域`);
  }
  if (hostname.length > 253 || !hostname.split('.').every(label =>
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) {
    throw new Error(`${location} 不是有效網域`);
  }
  return source ? normalizeHostname(hostname) : hostname;
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    // JSON 解析錯誤可能含檔案內容；只報檔名，避免輸出誤放的機密。
    const reason = err instanceof SyntaxError ? 'JSON 格式錯誤' : err.code || '無法讀取';
    throw new Error(`[網址設定] ${filePath}：${reason}`);
  }
}

function mergeSettings(defaults, custom) {
  keys(custom, ['urlConversion'], 'settings');
  const input = custom.urlConversion === undefined ? {} : custom.urlConversion;
  keys(input, ['enabled', 'handlers', 'rules'], 'urlConversion');

  const handlerInput = input.handlers === undefined ? {} : object(input.handlers, 'urlConversion.handlers');
  const handlers = Object.create(null);
  for (const id of new Set([...Object.keys(defaults.handlers), ...Object.keys(handlerInput)])) {
    validateId(id, 'urlConversion.handlers');
    const override = Object.hasOwn(handlerInput, id) ? handlerInput[id] : {};
    keys(override, ['enabled'], `urlConversion.handlers.${id}`);
    handlers[id] = Object.freeze({ enabled: boolean(
      override.enabled === undefined ? (defaults.handlers[id]?.enabled ?? true) : override.enabled,
      `urlConversion.handlers.${id}.enabled`,
    ) });
  }

  const ruleInput = input.rules === undefined ? {} : object(input.rules, 'urlConversion.rules');
  const rules = Object.create(null);
  const sources = new Map();
  for (const id of new Set([...Object.keys(defaults.rules), ...Object.keys(ruleInput)])) {
    validateId(id, 'urlConversion.rules');
    const location = `urlConversion.rules.${id}`;
    const override = Object.hasOwn(ruleInput, id) ? ruleInput[id] : {};
    keys(override, ['enabled', 'hosts', 'targetHost', 'stripQuery'], location);
    const raw = { enabled: true, stripQuery: false, ...defaults.rules[id], ...override };
    if (!Array.isArray(raw.hosts) || raw.hosts.length === 0) {
      throw new Error(`${location}.hosts 必須是非空網域陣列`);
    }
    const hosts = raw.hosts.map((host, index) => domain(host, `${location}.hosts[${index}]`, true));
    const targetHost = domain(raw.targetHost, `${location}.targetHost`);
    for (const host of hosts) {
      if (sources.has(host)) throw new Error(`${location}.hosts：${host} 與規則 ${sources.get(host)} 重複`);
      if (host === normalizeHostname(targetHost)) throw new Error(`${location} 的來源和目標網域不可相同`);
      sources.set(host, id);
    }
    rules[id] = Object.freeze({
      id,
      enabled: boolean(raw.enabled, `${location}.enabled`),
      hosts: Object.freeze(hosts),
      targetHost,
      stripQuery: boolean(raw.stripQuery, `${location}.stripQuery`),
    });
  }
  return Object.freeze({
    enabled: boolean(input.enabled === undefined ? defaults.enabled : input.enabled, 'urlConversion.enabled'),
    handlers: Object.freeze(handlers),
    rules: Object.freeze(rules),
  });
}

function loadSettings({ settingsFile = process.env.SETTINGS_FILE, projectRoot = PROJECT_ROOT } = {}) {
  const defaults = readJson(path.join(PROJECT_ROOT, 'settings.example.json')).urlConversion;
  const explicit = settingsFile !== undefined && settingsFile !== '';
  const filePath = path.resolve(projectRoot, explicit ? settingsFile : 'settings.json');
  let custom = {};
  // 只有「未指定路徑且預設檔案不存在」才使用內附預設；其他讀取錯誤明確中止啟動。
  try {
    fs.statSync(filePath);
    custom = readJson(filePath);
  } catch (err) {
    if (explicit || err.code !== 'ENOENT') throw err;
  }
  return mergeSettings(defaults, custom);
}

const settings = loadSettings();

function validateHandlers(handlers, config = settings) {
  const dedicated = handlers.filter(handler => handler.name !== 'simple');
  const names = new Set(dedicated.map(handler => handler.name));
  for (const id of Object.keys(config.handlers)) {
    if (!names.has(id)) throw new Error(`[網址設定] 未知的專用處理器：${id}`);
  }
  for (const rule of Object.values(config.rules)) {
    if (names.has(rule.id)) throw new Error(`[網址設定] 規則名稱 ${rule.id} 與專用處理器重複`);
    for (const host of rule.hosts) {
      const handler = dedicated.find(item => item.match(host));
      if (handler) throw new Error(`[網址設定] ${rule.id} 的 ${host} 由 ${handler.name} 專用處理器負責`);
    }
  }
}

module.exports = { settings, loadSettings, normalizeHostname, validateHandlers };
