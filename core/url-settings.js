'use strict';

const db = require('./db');
const { settings } = require('./url-config');
const handlers = require('../handlers');

const targets = [
  ...handlers.filter(handler => handler.name !== 'simple').map(handler => Object.freeze({
    id: handler.name, kind: 'handler', enabled: settings.handlers[handler.name]?.enabled ?? true,
  })),
  ...Object.values(settings.rules).map(rule => Object.freeze({ ...rule, kind: 'rule' })),
].sort((a, b) => a.id.localeCompare(b.id));
const targetsById = new Map(targets.map(target => [target.id, target]));

const selectMaster = db.prepare('SELECT enabled FROM url_conversion_settings WHERE guild_id = ?');
const selectTarget = db.prepare('SELECT enabled FROM url_conversion_overrides WHERE guild_id = ? AND target = ?');
const upsertMaster = db.prepare(`INSERT INTO url_conversion_settings (guild_id, enabled) VALUES (?, ?)
  ON CONFLICT(guild_id) DO UPDATE SET enabled = excluded.enabled`);
const upsertTarget = db.prepare(`INSERT INTO url_conversion_overrides (guild_id, target, enabled) VALUES (?, ?, ?)
  ON CONFLICT(guild_id, target) DO UPDATE SET enabled = excluded.enabled`);
const deleteTarget = db.prepare('DELETE FROM url_conversion_overrides WHERE guild_id = ? AND target = ?');

function requireTarget(id) {
  const target = targetsById.get(id);
  if (!target) throw new Error(`未知的網址轉換規則：${id}`);
  return target;
}

function requireGuild(guildId) {
  if (typeof guildId !== 'string' || !guildId) throw new Error('網址開關只能在伺服器中設定');
}

function getMaster(guildId) {
  const row = guildId ? selectMaster.get(guildId) : undefined;
  return { enabled: row ? Boolean(row.enabled) : settings.enabled, overridden: Boolean(row) };
}

function getTarget(guildId, id) {
  const target = requireTarget(id);
  const row = guildId ? selectTarget.get(guildId, id) : undefined;
  return { enabled: row ? Boolean(row.enabled) : target.enabled, overridden: Boolean(row) };
}

function setMaster(guildId, enabled) {
  requireGuild(guildId);
  if (typeof enabled !== 'boolean') throw new TypeError('enabled 必須是布林值');
  upsertMaster.run(guildId, Number(enabled));
  return getMaster(guildId);
}

// 在同一交易內讀取並切換，避免多個程序同時 toggle 時遺失其中一次操作。
const toggleTarget = db.transaction((guildId, id) => {
  requireGuild(guildId);
  const next = !getTarget(guildId, id).enabled;
  upsertTarget.run(guildId, id, Number(next));
  return getTarget(guildId, id);
});

function resetTarget(guildId, id) {
  requireGuild(guildId);
  requireTarget(id);
  deleteTarget.run(guildId, id);
  return getTarget(guildId, id);
}

module.exports = {
  targets: Object.freeze(targets), requireTarget, getMaster, getTarget, setMaster,
  toggleTarget: (guildId, id) => toggleTarget.immediate(guildId, id), resetTarget,
};
