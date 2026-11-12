import { endpointError, normLang } from '../lib/i18n.js';
import { authed } from '../lib/runtime.js';
import { updateSettings } from '../lib/repo/state.js';
import { settingsView, NOTIFY_TYPES, NOTIFY_DEFAULTS, MIRROR_GROUPS, parseHm } from '../lib/view.js';
import { isValidTimeZone, RETENTION_CHOICES, PURGE_AFTER_DISCONNECT_CHOICES } from '../lib/util.js';
import { normalizeKeywords } from '../lib/text.js';
import { requirePro } from '../lib/plans.js';

const READ_MODES = new Set(['off', 'all', 'chats']);
const AUTO_LOCK = [null, 0, 1, 5, 15, 60];
const MIRROR_MAX_MB = [null, 20, 50, 100, 500];
const bad = (key, code) => endpointError(key, null, code);

export default authed(async (input, { owner, settings }) => {
  if (!input || input.get) return { settings: settingsView(settings) };
  /** @type {Record<string, any>} */
  const patch = {};
  if ('notificationsEnabled' in input) patch.notificationsEnabled = !!input.notificationsEnabled;
  if ('notifyOwn' in input) patch.notifyOwn = !!input.notifyOwn;
  if ('lockEnabled' in input) {
    if (!input.lockEnabled && settings.pinHash) throw bad('err.removePinFirst', 'PIN_SET');
    patch.lockEnabled = !!input.lockEnabled;
  }
  if ('lockMode' in input) {
    // Снять PIN можно только через endpoint pin (с проверкой); здесь — выкл и биометрия.
    if (settings.pinHash) throw bad('err.removePinFirst', 'PIN_SET');
    if (!['off', 'biometric'].includes(input.lockMode)) throw bad('err.badLock', 'BAD_LOCK');
    patch.lockMode = input.lockMode;
    patch.lockEnabled = input.lockMode !== 'off';
  }
  if ('lang' in input) {
    patch.lang = normLang(input.lang);
    patch.langSource = 'manual';
  }
  if ('timezone' in input) {
    if (!isValidTimeZone(String(input.timezone))) throw endpointError('err.badTz', null, 'BAD_TZ');
    patch.timezone = String(input.timezone);
    patch.tzSource = input.tzSource === 'auto' ? 'auto' : 'manual';
    // Дни статистики считаются в поясе — при смене её надо пересобрать.
    if (patch.timezone !== settings.timezone) patch.statsBuilt = false;
  }
  if ('retentionDays' in input) {
    const v = input.retentionDays == null ? null : Number(input.retentionDays);
    await requirePro.retention(owner, v);
    if (!RETENTION_CHOICES.includes(v)) throw endpointError('err.badRetention', null, 'BAD_RETENTION');
    patch.retentionDays = v;
  }
  if ('keywords' in input) patch.keywords = normalizeKeywords(input.keywords);
  if ('readMode' in input) {
    if (!READ_MODES.has(input.readMode)) throw endpointError('err.badReadMode', null, 'BAD_READ_MODE');
    patch.readMode = input.readMode;
  }
  if ('quietHours' in input) {
    const q = input.quietHours;
    if (q == null) patch.quietHours = null;
    else {
      const from = parseHm(q.from), to = parseHm(q.to);
      if (from == null || to == null || from === to) throw bad('err.badQuiet', 'BAD_QUIET');
      patch.quietHours = { from: String(q.from).padStart(5, '0'), to: String(q.to).padStart(5, '0') };
    }
  }
  if ('notifyTypes' in input) {
    const t = input.notifyTypes ?? {};
    patch.notifyTypes = Object.fromEntries(NOTIFY_TYPES.map((k) => [k, typeof t[k] === 'boolean' ? t[k] : NOTIFY_DEFAULTS[k]]));
  }
  if ('hidePreview' in input) patch.hidePreview = !!input.hidePreview;
  if ('keywordWholeWord' in input) patch.keywordWholeWord = !!input.keywordWholeWord;
  if ('keywordLoud' in input) patch.keywordLoud = !!input.keywordLoud;
  if ('keywordExclude' in input) patch.keywordExclude = normalizeKeywords(input.keywordExclude);
  if ('mirrorTypes' in input) {
    const list = Array.isArray(input.mirrorTypes) ? input.mirrorTypes.filter((g) => MIRROR_GROUPS.includes(g)) : null;
    // Все группы — то же, что «без ограничений» (null): новые типы тоже будут копироваться.
    patch.mirrorTypes = !list || list.length === MIRROR_GROUPS.length ? null : [...new Set(list)];
  }
  if ('mirrorMaxMb' in input) {
    const v = input.mirrorMaxMb == null ? null : Number(input.mirrorMaxMb);
    if (!MIRROR_MAX_MB.includes(v)) throw bad('err.badMirrorLimit', 'BAD_MIRROR_LIMIT');
    patch.mirrorMaxMb = v;
  }
  if ('autoLockMin' in input) {
    const v = input.autoLockMin == null ? null : Number(input.autoLockMin);
    if (!AUTO_LOCK.includes(v)) throw bad('err.badAutoLock', 'BAD_AUTO_LOCK');
    patch.autoLockMin = v;
  }
  if ('purgeAfterDisconnectDays' in input) {
    const v = input.purgeAfterDisconnectDays == null ? null : Number(input.purgeAfterDisconnectDays);
    if (!PURGE_AFTER_DISCONNECT_CHOICES.includes(v)) throw bad('err.badPurge', 'BAD_PURGE');
    patch.purgeAfterDisconnectDays = v;
  }
  if ('markOnboarded' in input && input.markOnboarded) patch.onboardedAt = new Date();
  const row = await updateSettings(owner, patch);
  return { settings: settingsView(row) };
});
