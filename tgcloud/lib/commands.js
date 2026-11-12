// Команды бота в личном чате
import { api, EndpointError } from 'sdk';
import { ensureSettings, updateSettings, isMuted, setChatPref, getMeta, setMeta, syncLang } from './repo/state.js';
import { listChats, overall } from './repo/messages.js';
import { getArchive } from './archive.js';
import { resolveRange, periodTimes } from './repo/chats.js';
import { sendExport, EXPORT_PERIODS, EXPORT_FORMATS } from './export.js';
import { sendView } from './runtime.js';
import { openOnly } from './links.js';
import { h, p, blocks, footer, list, table, escapeHtml } from './text.js';
import { t, errorText, normLang } from './i18n.js';
import { notifyConnected } from './events.js';
import { RETENTION_CHOICES } from './util.js';

/**
 * @typedef {{ owner: number, args: string[], m: any, lang: 'ru' | 'en' }} CommandCtx lang — язык владельца (settings.lang)
 * @typedef {{ name: string, description: string | ((lang: any) => string), hidden?: boolean, run: (c: CommandCtx) => Promise<unknown> }} Command
 * description — ключ словаря ('cmd.<имя>') или функция языка: меню и /help показывают её на языке читателя.
 */

/** @param {Command} cmd @param {any} lang */
export const describeCommand = (cmd, lang) => (typeof cmd.description === 'function' ? cmd.description(lang) : t(lang, cmd.description));

const reply = (owner, html, extra = {}) => sendView(owner, { html, ...extra });

/** @param {any} msg */
function chatOfNotification(msg) {
  for (const row of msg?.reply_markup?.inline_keyboard ?? []) {
    for (const b of row) {
      const m = /^mute:(-?\d+)$/.exec(b?.callback_data ?? '');
      if (m) return Number(m[1]);
    }
  }
  return null;
}

async function muteChooser(owner, wantMuted, lang) {
  const chats = (await listChats(owner, { limit: 30 })).filter((c) => c.muted !== wantMuted).slice(0, 6);
  if (!chats.length) return reply(owner, p(t(lang, wantMuted ? 'commands.mute.allMuted' : 'commands.mute.none')));
  return reply(owner, p(t(lang, wantMuted ? 'commands.mute.askMute' : 'commands.mute.askUnmute')), {
    reply_markup: { inline_keyboard: chats.map((c) => [{ text: `${wantMuted ? '🔕' : '🔔'} ${c.chatName ?? t(lang, 'commands.chatN', { id: c.chatId })}`.slice(0, 60), callback_data: `mute:${c.chatId}` }]) },
  });
}

async function setMute(c, muted) {
  const chatId = chatOfNotification(c.m.reply_to_message);
  if (chatId == null) return muteChooser(c.owner, muted, c.lang);
  if ((await isMuted(c.owner, chatId)) === muted) return reply(c.owner, p(t(c.lang, muted ? 'commands.mute.already' : 'commands.unmute.already')));
  await setChatPref(c.owner, chatId, { muted });
  return reply(c.owner, p(t(c.lang, muted ? 'commands.mute.done' : 'commands.unmute.done')));
}

const STATS_PERIODS = { today: 1, '7d': 7, '30d': 30 };

/** @type {Command[]} */
export const COMMANDS = [
  {
    name: 'start', description: 'cmd.start',
    run: async (c) => {
      const s = await updateSettings(c.owner, { notificationsBlocked: false });
      await syncLang(c.owner, s, c.m?.from?.language_code);
      await syncCommands().catch((e) => console.warn('setMyCommands', e));
      return notifyConnected(c.owner);
    },
  },
  {
    name: 'help', description: 'cmd.help',
    run: async (c) => reply(c.owner, blocks(
      h(3, t(c.lang, 'commands.help.title')),
      list(COMMANDS.filter((x) => !x.hidden).map((x) => ({ html: `/${x.name} — ${escapeHtml(describeCommand(x, c.lang))}` }))),
      footer(t(c.lang, 'commands.help.footer')),
    ), { reply_markup: await openOnly(c.lang) }),
  },
  { name: 'app', description: 'cmd.app', run: async (c) => reply(c.owner, p(t(c.lang, 'commands.app')), { reply_markup: await openOnly(c.lang) }) },
  // Числовой id нужен оператору для переменной OPERATOR_ID (docs/deploy.md); в меню не выводим.
  { name: 'id', description: 'cmd.id', hidden: true, run: async (c) => reply(c.owner, p(t(c.lang, 'commands.id', { id: c.owner }))) },
  {
    name: 'pause', description: 'cmd.pause',
    run: async (c) => { await updateSettings(c.owner, { notificationsEnabled: false }); return reply(c.owner, p(t(c.lang, 'commands.pause.done'))); },
  },
  {
    name: 'resume', description: 'cmd.resume',
    run: async (c) => { await updateSettings(c.owner, { notificationsEnabled: true }); return reply(c.owner, p(t(c.lang, 'commands.resume.done'))); },
  },
  { name: 'mute', description: 'cmd.mute', run: (c) => setMute(c, true) },
  { name: 'unmute', description: 'cmd.unmute', run: (c) => setMute(c, false) },
  {
    name: 'export', description: 'cmd.export',
    run: async (c) => {
      const s = await ensureSettings(c.owner);
      const period = c.args.find((a) => EXPORT_PERIODS.includes(a)) ?? 'all';
      const format = c.args.find((a) => EXPORT_FORMATS.includes(/** @type {any} */ (a))) ?? 'html';
      try { await sendExport(c.owner, s.timezone, { period, format, kind: c.args.find((a) => ['deleted', 'edited', 'favorite'].includes(a)), lang: c.lang }); }
      catch (e) {
        if (e instanceof EndpointError) return reply(c.owner, p(escapeHtml(errorText(e, c.lang))));
        throw e;
      }
      return null;
    },
  },
  {
    name: 'stats', description: 'cmd.stats',
    run: async (c) => {
      const s = await ensureSettings(c.owner);
      const key = c.args.find((a) => a in STATS_PERIODS) ?? '7d';
      const range = resolveRange({ days: STATS_PERIODS[key] }, s.timezone);
      const [cur, all] = await Promise.all([periodTimes(c.owner, range), overall(c.owner)]);
      const label = key === 'today' ? t(c.lang, 'commands.stats.today') : t(c.lang, 'commands.stats.days', { n: STATS_PERIODS[key] });
      return reply(c.owner, blocks(
        h(3, `📊 ${label}`),
        table([
          [{ html: t(c.lang, 'commands.stats.new'), header: true }, { html: t(c.lang, 'commands.stats.deleted'), header: true }, { html: t(c.lang, 'commands.stats.edits'), header: true }],
          [{ html: String(cur.created.length), align: 'center' }, { html: String(cur.deleted.length), align: 'center' }, { html: String(cur.edited.length), align: 'center' }],
        ], { compact: true }),
        footer(t(c.lang, 'commands.stats.total', { total: all.total, chats: all.chats })),
      ), { reply_markup: await openOnly(c.lang) });
    },
  },
  {
    name: 'settings', description: 'cmd.settings',
    run: async (c) => {
      const s = await ensureSettings(c.owner);
      const a = await getArchive(c.owner);
      const q = /** @type {any} */ (s.quietHours);
      const L = c.lang;
      const ret = s.retentionDays && RETENTION_CHOICES.includes(s.retentionDays) ? t(L, 'commands.retDays', { n: s.retentionDays }) : t(L, 'commands.retAlways');
      return reply(c.owner, blocks(
        h(3, t(L, 'commands.settings.title')),
        list([
          { html: t(L, 'commands.settings.notifications', { state: t(L, s.notificationsEnabled ? 'commands.on' : 'commands.off') }) },
          { html: t(L, 'commands.settings.quiet', { value: q?.from && q?.to ? `${q.from}–${q.to}` : t(L, 'commands.none') }) },
          { html: t(L, 'commands.settings.archive', { value: a ? (a.status === 'active' ? escapeHtml(a.title ?? t(L, 'commands.archiveLinked')) : t(L, 'commands.archiveLost')) : t(L, 'commands.archiveNone') }) },
          { html: t(L, 'commands.settings.keep', { ret, tz: escapeHtml(s.timezone) }) },
        ]),
        footer(t(L, 'commands.settings.footer')),
      ), { reply_markup: await openOnly(L) });
    },
  },
  {
    name: 'pin_reset', description: 'cmd.pin_reset',
    run: (c) => reply(c.owner, blocks(
      h(3, t(c.lang, 'commands.pin.title')),
      p(t(c.lang, 'commands.pin.body')),
    ), { reply_markup: { inline_keyboard: [[{ text: t(c.lang, 'commands.pin.reset'), callback_data: 'pin:reset' }, { text: t(c.lang, 'kb.cancel'), callback_data: 'pin:keep' }]] } }),
  },
  {
    name: 'delete_me', description: 'cmd.delete_me',
    run: (c) => reply(c.owner, blocks(
      h(3, t(c.lang, 'commands.erase.title')),
      p(t(c.lang, 'commands.erase.body')),
    ), { reply_markup: { inline_keyboard: [[{ text: t(c.lang, 'commands.erase.confirm'), callback_data: 'erase:ok' }, { text: t(c.lang, 'kb.cancel'), callback_data: 'erase:no' }]] } }),
  },
];

/** @param {string} text */
export function parseCommand(text) {
  const m = /^\/([a-z_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/i.exec(text.trim());
  if (!m) return null;
  return { name: m[1].toLowerCase(), args: (m[2] ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean) };
}

/** @returns {Promise<boolean>} была ли это команда */
export async function runCommand(owner, m) {
  const parsed = parseCommand(String(m.text ?? ''));
  if (!parsed) return false;
  let s = await ensureSettings(owner);
  if (!s.langSource) s = await syncLang(owner, s, m?.from?.language_code);
  const cmd = COMMANDS.find((c) => c.name === parsed.name) ?? COMMANDS.find((c) => c.name === 'help');
  await /** @type {Command} */ (cmd).run({ owner, args: parsed.args, m, lang: normLang(s.lang) });
  return true;
}

/**
 * Меню команд в клиенте Telegram: без language_code — английское (по умолчанию для всех),
 * для ru/uk/be/kk — русское. Обновляем, когда поменялся набор команд или версия.
 */
const COMMANDS_VERSION = '3';
export const RU_MENU_CODES = ['ru', 'uk', 'be', 'kk'];
export async function syncCommands() {
  const key = COMMANDS.filter((c) => !c.hidden).map((c) => c.name).join(',');
  if ((await getMeta('commands_version')) === `${COMMANDS_VERSION}:${key}`) return false;
  const scope = { type: 'all_private_chats' };
  const menu = (/** @type {'ru' | 'en'} */ lang) => COMMANDS.filter((c) => !c.hidden && c.name !== 'start')
    .map((c) => ({ command: c.name, description: describeCommand(c, lang).slice(0, 256) }));
  await api.setMyCommands({ commands: menu('en'), scope });
  for (const language_code of RU_MENU_CODES) await api.setMyCommands({ commands: menu('ru'), scope, language_code });
  await setMeta('commands_version', `${COMMANDS_VERSION}:${key}`);
  return true;
}
