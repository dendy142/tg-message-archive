// Экранирование, entities → HTML, rich-разметка, ключевые слова
import { localeOf, t } from './i18n.js';
import { KEYWORDS_MAX, KEYWORD_MAX_LEN } from './util.js';

// ── text: экранирование и форматирование
/** @param {string} s */
export function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** @param {number} id @param {string} name */
export const userLink = (id, name) => `<a href="tg://user?id=${id}">${escapeHtml(name)}</a>`;

/** @param {Date} date @param {string} tz @param {any} [lang] */
export function formatTime(date, tz, lang = 'ru') {
  return new Intl.DateTimeFormat(localeOf(lang), {
    timeZone: tz, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(date);
}

/** @param {Date} date @param {string} tz @param {any} [lang] */
export function formatDateTime(date, tz, lang = 'ru') {
  return new Intl.DateTimeFormat(localeOf(lang), {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(date);
}

/** @param {string} s @param {number} n */
export const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

/** @param {number} n байты → «1.2 МБ» @param {any} [lang] */
export const fmtSize = (n, lang = 'ru') => (n < 1024 ? `${n} ${t(lang, 'unit.b')}` : n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} ${t(lang, 'unit.kb')}` : `${(n / 1024 / 1024).toFixed(1)} ${t(lang, 'unit.mb')}`);

/**
 * Нормализация для поиска: нижний регистр (JS понимает кириллицу, в отличие от SQLite LIKE),
 * ё → е, схлопнутые пробелы. Тем же преобразованием проходит и запрос.
 * @param {...(string | null | undefined)} parts
 */
export function normalizeSearch(...parts) {
  return parts.filter(Boolean).join(' ').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
}

/** Экранирует спецсимволы LIKE (`ESCAPE '\'`), чтобы «100%» искало буквально. @param {string} s */
export const escapeLike = (s) => s.replace(/[\\%_]/g, (c) => '\\' + c);

/** @param {any} u */
export const personName = (u) => (u ? [u.first_name, u.last_name].filter(Boolean).join(' ') || u.title || null : null);

const TAG_RE = /<\/?([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*>/g;
const VOID_TAGS = new Set(['br', 'hr', 'img', 'input']);
const NO_BREAK = new Set(['pre', 'code']);

/** @param {string} html @param {number} [limit] */
export function chunkHtml(html, limit = 3500) {
  if (html.length <= limit) return [html];
  /** @type {{ tag?: string, close?: boolean, name?: string, text?: string }[]} */
  const tokens = [];
  let last = 0;
  for (const m of html.matchAll(TAG_RE)) {
    const at = /** @type {number} */ (m.index);
    if (at > last) tokens.push({ text: html.slice(last, at) });
    tokens.push({ tag: m[0], name: m[1].toLowerCase(), close: m[0][1] === '/' });
    last = at + m[0].length;
  }
  if (last < html.length) tokens.push({ text: html.slice(last) });

  /** @type {string[]} */
  const parts = [];
  /** @type {{ name: string, tag: string }[]} */
  let stack = [];
  let buf = '';
  let brk = /** @type {{ pos: number, stack: { name: string, tag: string }[] } | null} */ (null);
  const closers = (st) => st.slice().reverse().map((o) => `</${o.name}>`).join('');
  const openers = (st) => st.map((o) => o.tag).join('');
  const reserve = () => stack.reduce((n, o) => n + o.name.length + 3, 0);
  const inNoBreak = () => stack.some((o) => NO_BREAK.has(o.name));

  const flush = () => {
    if (brk && brk.pos > openers(brk.stack).length && brk.pos < buf.length) {
      parts.push(buf.slice(0, brk.pos) + closers(brk.stack));
      buf = openers(brk.stack) + buf.slice(brk.pos);
    } else {
      parts.push(buf + closers(stack));
      buf = openers(stack);
    }
    brk = null;
  };
  const pushText = (s) => {
    while (s.length) {
      if (buf.length + s.length + reserve() <= limit) { buf += s; return; }
      let room = limit - buf.length - reserve();
      if (room <= 0 || brk) { flush(); room = limit - buf.length - reserve(); if (room <= 0) room = 1; }
      if (s.length <= room) { buf += s; return; }
      let cut = room;
      const amp = s.lastIndexOf('&', cut - 1);
      if (amp >= 0 && amp > cut - 10 && s.indexOf(';', amp) >= cut) cut = amp;
      if (cut <= 0) cut = room;
      buf += s.slice(0, cut);
      s = s.slice(cut);
      flush();
    }
  };

  for (const t of tokens) {
    if (t.tag) {
      if (buf.length + t.tag.length + reserve() + (t.close ? 0 : (t.name?.length ?? 0) + 3) > limit) flush();
      buf += t.tag;
      if (t.close) {
        const i = stack.map((o) => o.name).lastIndexOf(/** @type {string} */ (t.name));
        if (i >= 0) stack = [...stack.slice(0, i), ...stack.slice(i + 1)];
      } else if (!VOID_TAGS.has(/** @type {string} */ (t.name))) stack = [...stack, { name: /** @type {string} */ (t.name), tag: t.tag }];
      continue;
    }
    for (const piece of /** @type {string} */ (t.text).split(/(?<=\n)/)) {
      if (buf.length + piece.length + reserve() > limit) {
        if (brk) flush();
        pushText(piece);
      } else buf += piece;
      if (piece.endsWith('\n') && !inNoBreak()) brk = { pos: buf.length, stack };
    }
  }
  if (buf && buf !== openers(stack)) parts.push(buf + closers(stack));
  return parts.filter((p) => p.replace(TAG_RE, '').trim().length > 0 || p === parts[0]);
}

// ── entities: MessageEntity (Bot API) → Telegram-HTML.
// Смещения заданы в UTF-16 code units — как и индексы строк JS, работаем напрямую.
/** @typedef {{ type: string, offset: number, length: number, url?: string, user?: { id: number }, language?: string, custom_emoji_id?: string }} Entity */

/** @type {Record<string, [string, string]>} */
const WRAP = {
  bold: ['<b>', '</b>'],
  italic: ['<i>', '</i>'],
  underline: ['<u>', '</u>'],
  strikethrough: ['<s>', '</s>'],
  spoiler: ['<tg-spoiler>', '</tg-spoiler>'],
  code: ['<code>', '</code>'],
  blockquote: ['<blockquote>', '</blockquote>'],
  expandable_blockquote: ['<blockquote expandable>', '</blockquote>'],
};

/** Ссылки только безопасных схем: javascript:/data: из чужого сообщения в Mini App не попадут. */
export const SAFE_URL = /^(https?:\/\/|tg:\/\/)/i;
const LANG = /^[\w+#.-]{1,32}$/;

/** @param {Entity} e @returns {[string, string] | null} */
function openTag(e) {
  if (WRAP[e.type]) return WRAP[e.type];
  if (e.type === 'pre') {
    const lang = e.language && LANG.test(e.language) ? e.language : null;
    return [lang ? `<pre><code class="language-${lang}">` : '<pre>', lang ? '</code></pre>' : '</pre>'];
  }
  if (e.type === 'text_link' && e.url && SAFE_URL.test(e.url.trim())) return [`<a href="${escapeHtml(e.url.trim())}">`, '</a>'];
  if (e.type === 'text_mention' && Number.isSafeInteger(Number(e.user?.id))) return [`<a href="tg://user?id=${Number(e.user?.id)}">`, '</a>'];
  if (e.type === 'custom_emoji' && /^\d+$/.test(e.custom_emoji_id ?? '')) return [`<tg-emoji emoji-id="${e.custom_emoji_id}">`, '</tg-emoji>'];
  return null;
}

/** @param {string} text @param {Entity[] | null | undefined} entities */
export function entitiesToHtml(text, entities) {
  if (!entities?.length) return escapeHtml(text);
  const sorted = [...entities]
    .filter((e) => e.length > 0 && e.offset >= 0 && e.offset + e.length <= text.length)
    .sort((a, b) => a.offset - b.offset || b.length - a.length);
  return render(text, sorted, 0, text.length);
}

/** @param {string} text @param {Entity[]} ents @param {number} from @param {number} to */
function render(text, ents, from, to) {
  let out = '';
  let pos = from;
  let i = 0;
  while (i < ents.length) {
    const e = ents[i];
    if (e.offset < pos) { i++; continue; }
    const end = e.offset + e.length;
    if (end > to) { i++; continue; }
    out += escapeHtml(text.slice(pos, e.offset));
    let j = i + 1;
    /** @type {Entity[]} */
    const children = [];
    while (j < ents.length && ents[j].offset < end) { if (ents[j].offset + ents[j].length <= end) children.push(ents[j]); j++; }
    const inner = render(text, children, e.offset, end);
    const tag = openTag(e);
    out += tag ? tag[0] + inner + tag[1] : inner;
    pos = end;
    i = j;
  }
  return out + escapeHtml(text.slice(pos, to));
}

// ── rich: Rich HTML и деградация в обычный Telegram-HTML
/** Предел rich-сообщения по документации — 32768 символов; держим запас. */
export const RICH_LIMIT = 30_000;

export const h = (level, inner) => `<h${level}>${inner}</h${level}>`;
export const p = (inner) => `<p>${inner}</p>`;
export const footer = (inner) => `<footer>${inner}</footer>`;
export const mark = (inner) => `<mark>${inner}</mark>`;
export const br = '<br>';

export function quote(inner, cite, expandable = false) {
  return `<blockquote${expandable ? ' expandable' : ''}>${inner}${cite ? `<cite>${cite}</cite>` : ''}</blockquote>`;
}

export function details(summary, inner, open = false) {
  return `<details${open ? ' open' : ''}><summary>${summary}</summary>${inner}</details>`;
}

/** @param {{ html: string, checked?: boolean }[]} items */
export function list(items, ordered = false) {
  const tag = ordered ? 'ol' : 'ul';
  const li = items.map((it) =>
    `<li>${it.checked === undefined ? '' : `<input type="checkbox"${it.checked ? ' checked' : ''}>`}${it.html}</li>`).join('');
  return `<${tag}>${li}</${tag}>`;
}

/** @typedef {{ html: string, header?: boolean, align?: 'left' | 'center' | 'right' }} Cell */

/** @param {Cell[][]} rows @param {{ bordered?: boolean, striped?: boolean, compact?: boolean, caption?: string }} [opts] */
export function table(rows, opts = {}) {
  const attrs = [opts.bordered ? ' bordered' : '', opts.striped ? ' striped' : '', opts.compact ? ' compact' : ''].join('');
  const cap = opts.caption ? `<caption>${opts.caption}</caption>` : '';
  const body = rows.map((r) => `<tr>${r.map((c) => {
    const t = c.header ? 'th' : 'td';
    const al = c.align ? ` align="${c.align}"` : '';
    return `<${t}${al}>${c.html}</${t}>`;
  }).join('')}</tr>`).join('');
  return `<table${attrs}>${cap}${body}</table>`;
}

/** @param {Date} date */
export function time(date, fallbackText, format = 'dt') {
  return `<tg-time unix="${Math.floor(date.getTime() / 1000)}" format="${format}">${escapeHtml(fallbackText)}</tg-time>`;
}

/** @param {...(string | false | null | undefined)} parts */
export const blocks = (...parts) => parts.filter(Boolean).join('');

/** @param {string} html @param {number} [limit] @param {any} [lang] */
export function clampRich(html, limit = RICH_LIMIT, lang = 'ru') {
  if (html.length <= limit) return html;
  const at = html.lastIndexOf('</blockquote>', limit);
  const head = at > 0 ? html.slice(0, at + '</blockquote>'.length) : html.slice(0, limit);
  return head + footer(t(lang, 'bot.clamped'));
}

const NL = '\n';

/** @param {string} html */
export function toPlainHtml(html) {
  let s = html;
  s = s.replace(/<tg-button-row[^>]*>[\s\S]*?<\/tg-button-row>/g, '');
  s = s.replace(/<figure>[\s\S]*?<\/figure>/g, '');
  s = s.replace(/<tg-document[^>]*><\/tg-document>/g, '');
  s = s.replace(/<tg-time[^>]*>([\s\S]*?)<\/tg-time>/g, '$1');
  s = s.replace(/<h[1-6]>([\s\S]*?)<\/h[1-6]>/g, `<b>$1</b>${NL}`);
  s = s.replace(/<p>([\s\S]*?)<\/p>/g, `$1${NL}`);
  s = s.replace(/<footer>([\s\S]*?)<\/footer>/g, `<i>$1</i>${NL}`);
  s = s.replace(/<hr\/?>/g, `———${NL}`);
  s = s.replace(/<mark>([\s\S]*?)<\/mark>/g, '<b>$1</b>');
  s = s.replace(/<caption>([\s\S]*?)<\/caption>/g, `<i>$1</i>${NL}`);
  s = s.replace(/<details[^>]*><summary>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/g, `<b>$1</b>${NL}$2`);
  s = s.replace(/<input type="checkbox" checked>/g, '☑ ').replace(/<input type="checkbox">/g, '☐ ');
  s = s.replace(/<li>([\s\S]*?)<\/li>/g, `• $1${NL}`);
  s = s.replace(/<\/?[uo]l>/g, '');
  s = s.replace(/<tr>([\s\S]*?)<\/tr>/g, (_, row) =>
    row.replace(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g, '$1 · ').replace(/ · $/, '') + NL);
  s = s.replace(/<\/?table[^>]*>/g, '');
  s = s.replace(/<cite>([\s\S]*?)<\/cite>/g, `${NL}<i>— $1</i>`);
  s = s.replace(/<br\s*\/?>/g, NL);
  s = s.replace(/<\/?(sub|sup|ins|del|strong|em)>/g, '');
  return s.replace(/\n{3,}/g, '\n\n').trim();
}

// ── keywords: ключевые слова во входящих
/** @param {unknown} raw */
export function normalizeKeywords(raw) {
  const arr = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[,\n]/) : [];
  const seen = new Set();
  const out = [];
  for (const item of arr) {
    const w = normalizeSearch(String(item)).slice(0, KEYWORD_MAX_LEN);
    if (w && !seen.has(w)) { seen.add(w); out.push(w); }
    if (out.length >= KEYWORDS_MAX) break;
  }
  return out;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function contains(text, word, wholeWord) {
  if (!wholeWord) return text.includes(word);
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(word)}($|[^\\p{L}\\p{N}])`, 'u').test(text);
}

/**
 * @param {string[] | null | undefined} keywords @param {string | null} searchText уже нормализованный
 * @param {{ wholeWord?: boolean, exclude?: string[] | null }} [o]
 */
export function matchKeywords(keywords, searchText, o = {}) {
  if (!keywords?.length || !searchText) return [];
  if (o.exclude?.some((w) => w && searchText.includes(w))) return [];
  return keywords.filter((w) => contains(searchText, w, !!o.wholeWord));
}
