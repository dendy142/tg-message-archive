// lib/admin.js — инструменты оператора. Запуск из консоли — scripts/admin.mjs:
//   Сводка:            npm run admin -- '{}'
//   Назначить себя:    npm run admin -- '{"setOperator": 123456}' ("ifUnset": true — только если не задан)
//   Адрес Mini App:    npm run admin -- '{"setAppUrl": "https://app<id>.tgcloud.ai"}' (null — убрать);
//                      нужен web_app-кнопкам уведомлений, деплой из CI задаёт его сам
//   Кнопка меню:       npm run admin -- '{"setMenuButton": true}' — кнопка слева от поля ввода в чате
//                      с ботом открывает Mini App; уже настроенную не трогает. Свой текст и замена:
//                      '{"setMenuButton": {"text": "Open", "force": true}}'
//   Сбросить пробу:    npm run admin -- '{"resetCapability": "cap_profile_photos"}'
//   Повторить копии:   npm run admin -- '{"retryFailedMirrors": 123456}'
//   Пересборки:        '{"rebuildChats": {"all": true}}', '{"rebuildDailyStats": {"owner": 1}}', '{"rebuildFts": …}'
//   Самопроверка:      npm run admin -- '{"selftest": true}' — после деплоя в CI
//   Ошибки:            '{"errors": 20}'
//   Стереть владельца: '{"eraseOwner": 123456, "confirm": "ERASE"}'
//   Подписка Stars:    '{"setPrice": 99}' (null — выключить), '{"setPaySupport": "@support"}',
//                      '{"refundStarPayment": {"owner": 123456, "chargeId": "…"}}' — см. docs/plans.md
// `tgcloud run lib/admin` не работает: run запускает только handlers/ и endpoints/ («not
// runnable»). scripts/admin.mjs на время запуска кладёт вход endpoints/adminRun.js, который
// зовёт runFromCli ниже, и удаляет его — в облако этот вход не выкладывается.
// В боте — скрытая команда /admin (только для operator_id), в Mini App — раздел «Оператор».
// Пересборки и самопроверка лежат здесь же, а не отдельными модулями: каждый модуль идёт в счёт
// лимита платформы (tests/modules.test.ts).
import { db, api } from 'sdk';
import { eq, sql } from 'sdk/db';
import * as schema from '../schema.js';
import { settings, connections, messages, outbox, jobs, errors, appMeta } from '../schema.js';
import { getMeta, setMeta, delMeta, tsGte, isSet, resetCapabilitiesMemo, refreshCapabilities } from './repo/state.js';
import { retryFailedMirrors, buildFts } from './repo/messages.js';
import { buildAllChats, buildDaily } from './repo/chats.js';
import { tzOffsetMinutes } from './util.js';
import { eraseOwner } from './jobs.js';
import { recentErrors, sendView } from './runtime.js';
import { COMMANDS } from './commands.js';
import { h, blocks, table, list, p, escapeHtml, formatTime } from './text.js';
import { VERSION, COMMIT, BUILT_AT } from './version.js';
import { t } from './i18n.js';
import { setPriceStars, priceStars, refundPayment } from './plans.js';
import { isAppUrl, instanceAppUrl } from './links.js';

export async function operatorId() {
  const v = await getMeta('operator_id');
  return v ? Number(v) : null;
}
export const isOperator = async (userId) => userId != null && (await operatorId()) === Number(userId);

export async function operatorStats(now = Date.now()) {
  const count = (t, where) => db.$count(t, where);
  const [owners, activeConnections, pendingMirror, failedMirror, outboxDepth, activeJobs, errors24h, messageRows] = await Promise.all([
    count(settings),
    count(connections, isSet(connections.isEnabled)),
    count(messages, eq(messages.mirrorStatus, 'pending')),
    count(messages, eq(messages.mirrorStatus, 'failed')),
    count(outbox),
    count(jobs, eq(jobs.status, 'active')),
    count(errors, tsGte(errors.at, now - 86_400_000)),
    count(messages),
  ]);
  return { owners, activeConnections, pendingMirror, failedMirror, outboxDepth, activeJobs, errors24h, messageRows, version: { version: VERSION, commit: COMMIT, builtAt: BUILT_AT } };
}

/** @param {any} lang */
async function adminView(lang) {
  const s = await operatorStats();
  const last = await recentErrors(5);
  return blocks(
    h(3, t(lang, 'admin.title')),
    table(/** @type {[string, string | number][]} */ ([
      [t(lang, 'admin.owners'), s.owners], [t(lang, 'admin.connections'), s.activeConnections],
      [t(lang, 'admin.mirror'), `${s.pendingMirror} / ${s.failedMirror}`],
      [t(lang, 'admin.outbox'), s.outboxDepth], [t(lang, 'admin.jobs'), s.activeJobs],
      [t(lang, 'admin.errors24'), s.errors24h], [t(lang, 'admin.rows'), s.messageRows],
      [t(lang, 'admin.version'), `${s.version.version} (${s.version.commit})`],
    ]).map(([k, v]) => [{ html: k }, { html: String(v), align: 'right' }]), { compact: true }),
    last.length
      ? list(last.map((e) => ({ html: `${formatTime(new Date(e.at), 'UTC', lang)} UTC · <b>${escapeHtml(e.where)}</b>: ${escapeHtml(String(e.message ?? '').slice(0, 160))}` })))
      : p(t(lang, 'admin.noErrors')),
  );
}

COMMANDS.push({
  name: 'admin', description: 'cmd.admin', hidden: true,
  run: async (c) => { if (await isOperator(c.owner)) await sendView(c.owner, { html: await adminView(c.lang) }); },
});

// Обязательная по правилам Telegram для платежей команда. В меню не выводим: без цены
// платежей нет, а набор команд меню общий для всех.
COMMANDS.push({
  name: 'paysupport', description: 'cmd.paysupport', hidden: true,
  run: async (c) => {
    const contact = await getMeta('paysupport');
    const price = await priceStars();
    await sendView(c.owner, { html: blocks(h(3, t(c.lang, 'admin.paysupport.title')), p(escapeHtml(
      `${price ? t(c.lang, 'admin.paysupport.price', { price }) : t(c.lang, 'admin.paysupport.free')}`
      + (contact ? t(c.lang, 'admin.paysupport.contact', { contact }) : t(c.lang, 'admin.paysupport.noContact')),
    ))) });
  },
});

// ── Пересборки

/** @param {{ owner?: number, all?: boolean }} input */
async function ownersOf(input) {
  if (input?.all) return (await db.select({ id: settings.ownerUserId }).from(settings).all()).map((r) => Number(r.id));
  return input?.owner ? [Number(input.owner)] : [];
}

/** @param {{ owner?: number, all?: boolean }} input */
export async function rebuildChats(input = {}) {
  const owners = await ownersOf(input);
  if (!owners.length) return { ok: false, error: 'owner или all' };
  const out = {};
  for (const o of owners) out[o] = await buildAllChats(o);
  return { ok: true, chats: out };
}

/** @param {{ owner?: number, all?: boolean }} input */
export async function rebuildDailyStats(input = {}) {
  const owners = await ownersOf(input);
  if (!owners.length) return { ok: false, error: 'owner или all' };
  const out = {};
  for (const o of owners) out[o] = await buildDaily(o, { force: true });
  return { ok: true, owners: out };
}

/** @param {{ owner?: number, all?: boolean }} input */
export async function rebuildFts(input = {}) {
  const owners = await ownersOf(input);
  if (!owners.length) return { ok: false, error: 'owner или all' };
  const out = {};
  for (const o of owners) out[o] = await buildFts(o, { force: true });
  return { ok: true, built: out };
}

// ── Самопроверка: ловит расхождения локальной замены sdk и рантайма (Date в WHERE, btoa).
// Провал бросает ошибку — деплой в CI краснеет.

/** @param {string} name @param {() => Promise<string | void>} fn */
async function check(name, fn) {
  try {
    const note = await fn();
    return { name, ok: true, note: note ?? null };
  } catch (e) {
    return { name, ok: false, note: String(/** @type {any} */ (e)?.message ?? e).slice(0, 300) };
  }
}

const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

export async function selftest() {
  const checks = [];
  for (const [name, tbl] of Object.entries(schema)) {
    if (!tbl || typeof tbl !== 'object') continue;
    checks.push(await check(`table:${name}`, async () => { await db.select().from(/** @type {any} */ (tbl)).limit(1).all(); }));
  }
  checks.push(await check('timestamp_ms round-trip', async () => {
    const key = '_selftest';
    const at = new Date(Date.UTC(2026, 0, 2, 3, 4, 5, 678));
    await db.insert(appMeta).values({ key, value: 'x', updatedAt: at }).onConflictDoUpdate({ target: appMeta.key, set: { value: 'x', updatedAt: at } });
    const row = await db.select().from(appMeta).where(eq(appMeta.key, key)).get();
    assert(row?.updatedAt instanceof Date, `updatedAt is ${typeof row?.updatedAt}`);
    const got = new Date(/** @type {any} */ (row).updatedAt);
    assert(got.getTime() === at.getTime(), `got ${got.toISOString()}`);
    const hit = await db.select().from(appMeta).where(tsGte(appMeta.updatedAt, at)).all();
    assert(hit.some((r) => r.key === key), 'tsGte не нашёл строку');
    await delMeta(key);
  }));
  checks.push(await check('Intl timeZone', async () => {
    const off = tzOffsetMinutes(new Date(Date.UTC(2026, 6, 1)), 'Europe/Berlin');
    assert(off === 120, `Europe/Berlin летом = ${off} мин`);
  }));
  checks.push(await check('json1', async () => {
    const r = await db.get(sql`select json_extract(json_set('[0,0]', '$[1]', 5), '$[1]') as v`);
    assert(Number(/** @type {any} */ (r)?.v) === 5, `json_set → ${JSON.stringify(r)}`);
  }));
  checks.push(await check('getMe', async () => { const me = await api.getMe(); return `@${me.username}`; }));

  const caps = await refreshCapabilities();
  const operator = await getMeta('operator_id');
  let profilePhotos = null;
  if (operator) {
    try { await api.getUserProfilePhotos({ user_id: Number(operator), limit: 1 }); profilePhotos = true; }
    catch { profilePhotos = false; }
    await setMeta('cap_profile_photos', String(profilePhotos));
  }
  const failed = checks.filter((c) => !c.ok);
  const result = { selftest: failed.length ? 'FAIL' : 'PASS', checks, capabilities: { ...caps, profilePhotos } };
  if (failed.length) throw new Error(`selftest FAIL: ${failed.map((c) => `${c.name} — ${c.note}`).join('; ')}`);
  return result;
}

/**
 * Вход для scripts/admin.mjs: пускает только `tgcloud run` с одноразовым ключом.
 * Из Mini App (initData) или без ключа — отказ.
 * @param {Record<string, any>} input @param {any} ctx @param {string} key ключ, вписанный во вход
 */
export async function runFromCli(input, ctx, key) {
  if (ctx?.initData || typeof key !== 'string' || key.length < 16 || ctx?.adminKey !== key) {
    throw new Error('lib/admin: только из консоли оператора (npm run admin)');
  }
  return admin(input ?? {});
}

/**
 * Кнопку, уже открывающую Mini App, без force не трогает: её мог настроить оператор.
 * @param {{ text?: string, force?: boolean }} o
 */
async function setMenuButton(o = {}) {
  const url = await instanceAppUrl();
  if (!url) return { ok: false, error: 'setMenuButton: сначала задайте адрес Mini App — {"setAppUrl": "https://app<id>.tgcloud.ai"}' };
  const current = await api.getChatMenuButton({});
  if (current?.type === 'web_app' && !o.force) return { ok: true, menuButton: 'kept', url: current.web_app?.url ?? null };
  const text = String(o.text ?? 'Открыть').slice(0, 32);
  await api.setChatMenuButton({ menu_button: { type: 'web_app', text, web_app: { url: `${url}/` } } });
  return { ok: true, menuButton: 'set', url: `${url}/`, text };
}

/** @param {Record<string, any>} input */
export default async function admin(input = {}) {
  if (input.selftest) return { ok: true, ...(await selftest()) };
  if ('setPrice' in input) {
    // Правила Telegram: у бота с платежами должен быть контакт поддержки (/paysupport).
    if (input.setPrice != null && !(await getMeta('paysupport'))) return { ok: false, error: 'Сначала задайте контакт поддержки: {"setPaySupport": "@username"}' };
    try { return { ok: true, priceStars: await setPriceStars(input.setPrice) }; }
    catch (e) { return { ok: false, error: String(/** @type {any} */ (e)?.message ?? e) }; }
  }
  if ('setPaySupport' in input) {
    if (input.setPaySupport) await setMeta('paysupport', String(input.setPaySupport).slice(0, 200)); else await delMeta('paysupport');
    return { ok: true };
  }
  if (input.refundStarPayment) {
    const r = input.refundStarPayment;
    return { ok: true, ...(await refundPayment(Number(r.owner), r.chargeId ?? null)) };
  }
  if (input.setOperator != null) {
    const id = Number(input.setOperator);
    if (!Number.isSafeInteger(id) || id <= 0) return { ok: false, error: 'setOperator: нужен числовой id пользователя' };
    // ifUnset — для деплоя: не перетирать оператора, назначенного вручную.
    const current = await operatorId();
    if (input.ifUnset && current) return { ok: true, operator: current, unchanged: true };
    await setMeta('operator_id', String(id));
    return { ok: true, operator: id };
  }
  if ('setAppUrl' in input) {
    if (input.setAppUrl == null || input.setAppUrl === '') { await delMeta('app_url'); return { ok: true, appUrl: null }; }
    const url = String(input.setAppUrl).replace(/\/$/, '');
    // Только хост платформы: по этому адресу уведомления открывают Mini App с initData владельца.
    if (!isAppUrl(url)) return { ok: false, error: 'setAppUrl: нужен адрес вида https://app<id>.tgcloud.ai' };
    await setMeta('app_url', url);
    return { ok: true, appUrl: url };
  }
  if (input.setMenuButton) return setMenuButton(input.setMenuButton === true ? {} : input.setMenuButton);
  if (input.resetCapability) {
    const key = String(input.resetCapability);
    if (!/^cap/.test(key)) return { ok: false, error: 'resetCapability: ключ capabilities или cap_*' };
    await delMeta(key);
    resetCapabilitiesMemo();
    return { ok: true, reset: key };
  }
  if (input.retryFailedMirrors != null) return { ok: true, queued: await retryFailedMirrors(Number(input.retryFailedMirrors)) };
  if (input.rebuildChats) return rebuildChats(input.rebuildChats);
  if (input.rebuildDailyStats) return rebuildDailyStats(input.rebuildDailyStats);
  if (input.rebuildFts) return rebuildFts(input.rebuildFts);
  if (input.eraseOwner != null) {
    if (input.confirm !== 'ERASE') return { ok: false, error: 'eraseOwner: добавьте "confirm": "ERASE"' };
    return { ok: true, removed: await eraseOwner(Number(input.eraseOwner)) };
  }
  if (input.errors != null) return { ok: true, errors: await recentErrors(Math.min(Number(input.errors) || 20, 200)) };
  return { ok: true, operator: await operatorId(), appUrl: (await instanceAppUrl()) || null, stats: await operatorStats() };
}
