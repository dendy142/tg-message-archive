import { t, locale, getLang, pluralForm, type Key } from './i18n';

let TZ = 'UTC';
export function setTimezone(tz: string) { TZ = tz || TZ; }

const DAY = 86_400_000;
const fmtCache = new Map<string, Intl.DateTimeFormat>();
function dtf(opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = locale() + TZ + JSON.stringify(opts);
  let f = fmtCache.get(key);
  if (!f) {
    try { f = new Intl.DateTimeFormat(locale(), { timeZone: TZ, ...opts }); }
    catch { f = new Intl.DateTimeFormat(locale(), opts); }
    fmtCache.set(key, f);
  }
  return f;
}
const clean = (s: string) => s.replace(/\s?г\.$/, '').replace(/(\p{L})\.(?=\s|,|$)/gu, '$1');

export function dayKey(ms: number | null): string {
  if (!ms) return '';
  const p = dtf({ year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ms));
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return `${g('year')}-${g('month')}-${g('day')}`;
}
function daysAgo(ms: number): number {
  const a = Date.parse(dayKey(Date.now())), b = Date.parse(dayKey(ms));
  return Math.round((a - b) / DAY);
}
const sameYear = (ms: number) => dayKey(ms).slice(0, 4) === dayKey(Date.now()).slice(0, 4);

export function fmtTime(ms: number | null): string {
  if (!ms) return '';
  return dtf({ hour: '2-digit', minute: '2-digit' }).format(new Date(ms));
}

export function fmtSmart(ms: number | null): string {
  if (!ms) return '';
  const d = daysAgo(ms);
  if (d <= 0) return fmtTime(ms);
  if (d === 1) return t('common.yesterdayLower');
  if (d < 7) return dtf({ weekday: 'short' }).format(new Date(ms));
  if (sameYear(ms)) return clean(dtf({ day: 'numeric', month: 'short' }).format(new Date(ms)));
  return dtf({ day: '2-digit', month: '2-digit', year: '2-digit' }).format(new Date(ms));
}

export function fmtDay(ms: number | null): string {
  if (!ms) return '';
  const d = daysAgo(ms);
  if (d <= 0) return t('common.today');
  if (d === 1) return t('common.yesterday');
  const date = new Date(ms);
  if (d < 7) return cap(dtf({ weekday: 'long', day: 'numeric', month: 'long' }).format(date));
  if (sameYear(ms)) return dtf({ day: 'numeric', month: 'long' }).format(date);
  return clean(dtf({ day: 'numeric', month: 'long', year: 'numeric' }).format(date));
}

export function fmtDateTime(ms: number | null): string {
  if (!ms) return '';
  const d = daysAgo(ms);
  const tm = fmtTime(ms);
  if (d <= 0) return t('common.atTime', { date: t('common.todayLower'), time: tm });
  if (d === 1) return t('common.atTime', { date: t('common.yesterdayLower'), time: tm });
  const opts: Intl.DateTimeFormatOptions = sameYear(ms) ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' };
  return t('common.atTime', { date: clean(dtf(opts).format(new Date(ms))), time: tm });
}

export function fmtFull(ms: number | null): string {
  if (!ms) return '—';
  return `${clean(dtf({ day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(ms)))}, ${fmtTime(ms)}`;
}

export function fmtMonth(ms: number | null): string {
  if (!ms) return '';
  const s = clean(dtf({ month: 'long', year: 'numeric' }).format(new Date(ms)));
  return cap(getLang() === 'ru' ? s.replace(/^(\S+)/, (m) => MONTH_NOM[m] ?? m) : s);
}
const MONTH_NOM: Record<string, string> = {
  января: 'январь', февраля: 'февраль', марта: 'март', апреля: 'апрель', мая: 'май', июня: 'июнь',
  июля: 'июль', августа: 'август', сентября: 'сентябрь', октября: 'октябрь', ноября: 'ноябрь', декабря: 'декабрь',
};
export const monthKey = (ms: number | null) => dayKey(ms).slice(0, 7);

export function fmtShortDate(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  if (!y) return key;
  return clean(new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d))));
}
export function fmtLongDate(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  if (!y) return key;
  return cap(new Intl.DateTimeFormat(locale(), { weekday: 'short', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d))));
}

export function fmtDuration(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return '';
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}

export function fmtSpan(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return t('unit.sec', { n: s });
  const m = Math.round(s / 60);
  if (m < 60) return t('unit.min', { n: m });
  const h = Math.floor(m / 60), mm = m % 60;
  if (h < 24) return mm ? t('unit.hMin', { h, m: mm }) : t('unit.h', { n: h });
  const d = Math.floor(h / 24), hh = h % 24;
  return hh && d < 7 ? t('unit.dH', { d, h: hh }) : t('unit.d', { n: d });
}

export function fmtSize(n: number | null): string {
  if (n == null) return '';
  const dec = (v: number, digits: number) => (getLang() === 'ru' ? v.toFixed(digits).replace('.', ',') : v.toFixed(digits));
  if (n < 1024) return t('unit.b', { n });
  if (n < 1024 * 1024) return t('unit.kb', { n: Math.round(n / 1024) });
  if (n < 1024 * 1024 * 1024) return t('unit.mb', { n: dec(n / 1024 / 1024, 1) });
  return t('unit.gb', { n: dec(n / 1024 / 1024 / 1024, 2) });
}

const nfs = new Map<string, Intl.NumberFormat>();
const nf = { format: (n: number) => { const l = locale(); let f = nfs.get(l); if (!f) nfs.set(l, (f = new Intl.NumberFormat(l))); return f.format(n); } };
export const fmtNum = (n: number) => nf.format(n);

export const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

export const initials = (name: string | null) => (name ?? '?').trim().split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).slice(0, 2)
  .map((w) => Array.from(w.replace(/^[^\p{L}\p{N}]+/u, ''))[0] ?? '').join('').toUpperCase() || '?';

const GRADIENTS = [
  ['#ff885e', '#ff516a'], ['#ffcd6a', '#ffa85c'], ['#82b1ff', '#665fff'], ['#a0de7e', '#54cb68'],
  ['#53edd6', '#28c9b7'], ['#72d5fd', '#2a9ef1'], ['#e0a2f3', '#d669ed'],
];
export function avatarBg(id: number | string | null): string {
  const n = Math.abs(Number(id) || 0) % GRADIENTS.length;
  const [a, b] = GRADIENTS[n];
  return `linear-gradient(180deg, ${a}, ${b})`;
}

export const plural = (n: number, forms: Key) => pluralForm(n, t(forms));
export const count = (n: number, forms: Key) => `${fmtNum(n)} ${plural(n, forms)}`;

export const W = {
  msg: 'w.msg', chat: 'w.chat', deleted: 'w.deleted', edit: 'w.edit', file: 'w.file',
  event: 'w.event', result: 'w.result', word: 'w.word', day: 'w.day', attempt: 'w.attempt',
  times: 'w.times', daysInstr: 'w.daysInstr', filesPrep: 'w.filesPrep', char: 'w.char',
} as const satisfies Record<string, Key>;

export function archiveLink(m: { chatId: number; threadId: number | null; messageId: number }): string {
  const internal = String(m.chatId).replace(/^-100/, '');
  return m.threadId ? `https://t.me/c/${internal}/${m.threadId}/${m.messageId}` : `https://t.me/c/${internal}/${m.messageId}`;
}

export function allTimezones(): string[] {
  try {
    const f = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
    if (f) return f('timeZone');
  } catch { /* старые движки */ }
  return POPULAR_TZ;
}
export const POPULAR_TZ = [
  'Europe/Kaliningrad', 'Europe/Moscow', 'Europe/Samara', 'Asia/Yekaterinburg', 'Asia/Omsk', 'Asia/Novosibirsk',
  'Asia/Krasnoyarsk', 'Asia/Irkutsk', 'Asia/Yakutsk', 'Asia/Vladivostok', 'Asia/Magadan', 'Asia/Kamchatka',
  'Asia/Almaty', 'Asia/Tashkent', 'Asia/Bishkek', 'Asia/Tbilisi', 'Asia/Yerevan', 'Asia/Baku', 'Europe/Minsk',
  'Europe/Kyiv', 'Europe/Istanbul', 'Europe/Berlin', 'Europe/London', 'Asia/Dubai', 'America/New_York', 'UTC',
];
export const deviceTimezone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { return ''; } };

export function tzOffsetLabel(tz: string): string {
  try {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' }).formatToParts(new Date());
    const v = p.find((x) => x.type === 'timeZoneName')?.value ?? '';
    return v.replace('GMT', 'UTC') || 'UTC';
  } catch { return ''; }
}
const TZ_RU: Record<string, string> = {
  'Europe/Kaliningrad': 'Калининград', 'Europe/Moscow': 'Москва', 'Europe/Samara': 'Самара', 'Asia/Yekaterinburg': 'Екатеринбург',
  'Asia/Omsk': 'Омск', 'Asia/Novosibirsk': 'Новосибирск', 'Asia/Krasnoyarsk': 'Красноярск', 'Asia/Irkutsk': 'Иркутск',
  'Asia/Yakutsk': 'Якутск', 'Asia/Vladivostok': 'Владивосток', 'Asia/Magadan': 'Магадан', 'Asia/Kamchatka': 'Петропавловск-Камчатский',
  'Asia/Almaty': 'Алматы', 'Asia/Tashkent': 'Ташкент', 'Asia/Bishkek': 'Бишкек', 'Asia/Tbilisi': 'Тбилиси', 'Asia/Yerevan': 'Ереван',
  'Asia/Baku': 'Баку', 'Europe/Minsk': 'Минск', 'Europe/Kyiv': 'Киев', 'Europe/Kiev': 'Киев', 'Europe/Istanbul': 'Стамбул',
  'Europe/Berlin': 'Берлин', 'Europe/London': 'Лондон', 'Asia/Dubai': 'Дубай', 'America/New_York': 'Нью-Йорк', 'UTC': 'UTC',
  'Europe/Volgograd': 'Волгоград', 'Europe/Astrakhan': 'Астрахань', 'Europe/Saratov': 'Саратов', 'Europe/Ulyanovsk': 'Ульяновск',
  'Asia/Barnaul': 'Барнаул', 'Asia/Tomsk': 'Томск', 'Asia/Novokuznetsk': 'Новокузнецк', 'Asia/Chita': 'Чита',
  'Asia/Sakhalin': 'Сахалин', 'Asia/Qyzylorda': 'Кызылорда', 'Asia/Aqtobe': 'Актобе', 'Asia/Dushanbe': 'Душанбе',
  'Asia/Ashgabat': 'Ашхабад', 'Europe/Chisinau': 'Кишинёв', 'Europe/Riga': 'Рига', 'Europe/Vilnius': 'Вильнюс',
  'Europe/Tallinn': 'Таллин', 'Europe/Warsaw': 'Варшава', 'Europe/Prague': 'Прага', 'Europe/Paris': 'Париж', 'Asia/Bangkok': 'Бангкок',
  'Asia/Jerusalem': 'Иерусалим', 'Asia/Tel_Aviv': 'Тель-Авив', 'Europe/Belgrade': 'Белград', 'Asia/Shanghai': 'Шанхай',
};
export const tzCity = (tz: string) => (getLang() === 'ru' ? TZ_RU[tz] : undefined) ?? tz.split('/').pop()!.replace(/_/g, ' ');
