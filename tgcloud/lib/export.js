// Экспорт переписки: форматы файлов и сборка выгрузки
import { api, InputFile } from 'sdk';
import { escapeHtml, formatDateTime } from './text.js';
import { mediaLabel } from './media.js';
import { archiveMessageLink } from './links.js';
import { t, normLang, endpointError } from './i18n.js';
import { langOf } from './repo/state.js';
import { exportPage, countExport, chatTitle, editsForMessages } from './repo/messages.js';
import { resolveRange } from './repo/chats.js';
import { requirePro } from './plans.js';
import { EXPORT_MAX_ROWS, EXPORT_FILE_MAX_BYTES, EXPORT_TOTAL_MAX } from './util.js';

/** @typedef {'json' | 'csv' | 'md' | 'html'} ExportFormat */
export const EXPORT_FORMATS = /** @type {ExportFormat[]} */ (['json', 'csv', 'md', 'html']);
const EXT = { json: 'json', csv: 'csv', md: 'md', html: 'html' };

const INTERNAL = new Set([
  'businessConnectionId', 'ownerUserId', 'fileId', 'fileUniqueId', 'thumbFileId', 'searchText',
  'mirrorStatus', 'mirrorChatId', 'mirrorMessageId', 'mirrorThreadId', 'mirrorAttempts', 'mirrorRetryAt', 'mirrorError', 'mirrorDirty',
  'mirrorFileId', 'mirrorThumbFileId', 'mirrorCaptionMessageId',
]);

const dir = (r, lang) => t(lang, r.isOutgoing ? 'export.dir.out' : 'export.dir.in');
const kind = (r, lang) => (r.mediaType ? mediaLabel(r.mediaType, lang) : t(lang, 'export.kind.text'));
const body = (r) => r.text ?? r.caption ?? (r.mediaType ? `[${r.mediaType}]` : '');

/** @param {any} r */
export const mirrorLinkOf = (r) => (r.mirrorChatId && r.mirrorMessageId ? archiveMessageLink(r.mirrorChatId, r.mirrorThreadId, r.mirrorMessageId) : null);

/** @param {any} origin @param {any} [lang] */
export function forwardLabel(origin, lang = 'ru') {
  const o = origin;
  if (!o || typeof o !== 'object') return null;
  if (o.type === 'user') return [o.sender_user?.first_name, o.sender_user?.last_name].filter(Boolean).join(' ') || t(lang, 'export.fwd.user');
  if (o.type === 'hidden_user') return o.sender_user_name ?? t(lang, 'export.fwd.hidden');
  if (o.type === 'chat') return o.sender_chat?.title ?? t(lang, 'export.fwd.chat');
  if (o.type === 'channel') return o.chat?.title ?? t(lang, 'export.fwd.channel');
  return null;
}

function marks(r, lang) {
  const m = [];
  if (r.isDeleted) m.push(t(lang, 'export.mark.deleted'));
  if (r.oneTime) m.push(t(lang, 'export.mark.oneTime'));
  if (r.isFavorite) m.push(t(lang, 'export.mark.favorite'));
  const fwd = forwardLabel(r.forwardOrigin, lang);
  if (fwd) m.push(t(lang, 'export.mark.forwarded', { who: fwd }));
  if (r.replyToText) m.push(t(lang, 'export.mark.replyTo', { text: r.replyToText }));
  return m;
}

/** @param {any} r */
const editsOf = (r) => (Array.isArray(r.edits) ? r.edits : []);
const editLine = (e, lang) => t(lang, 'export.editLine', { old: e.oldText ?? '', new: e.newText ?? '' });
const iso = (v) => (v == null ? null : new Date(v).toISOString());

function toJson(rows) {
  const clean = rows.map((r) => {
    const o = {};
    for (const [k, v] of Object.entries(r)) if (!INTERNAL.has(k) && k !== 'edits') o[k] = v instanceof Date ? v.toISOString() : v;
    o.edits = editsOf(r).map((e) => ({ editedAt: iso(e.editedAt), oldText: e.oldText ?? null, newText: e.newText ?? null, mediaReplaced: !!e.oldMedia }));
    o.archiveLink = mirrorLinkOf(r);
    return o;
  });
  return JSON.stringify(clean, null, 2);
}

const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

function toCsv(rows, tz, lang) {
  const head = t(lang, 'export.csv.head').split('|');
  const yes = t(lang, 'export.yes');
  const lines = rows.map((r) => [
    formatDateTime(new Date(r.date), tz, lang), r.chatName ?? String(r.chatId), r.senderName ?? '', r.senderUsername ? `@${r.senderUsername}` : '',
    dir(r, lang), kind(r, lang), body(r), r.isDeleted ? yes : '', r.deletedAt ? formatDateTime(new Date(r.deletedAt), tz, lang) : '',
    r.oneTime ? yes : '', r.isFavorite ? yes : '', r.replyToText ?? '', forwardLabel(r.forwardOrigin, lang) ?? '',
    editsOf(r).map((e) => `${formatDateTime(new Date(e.editedAt), tz, lang)}: ${editLine(e, lang)}`).join(' | '), mirrorLinkOf(r) ?? '',
  ].map(csvCell).join(','));
  return '﻿' + [head.map(csvCell).join(','), ...lines].join('\r\n'); // BOM — иначе Excel ломает кириллицу
}

function toMarkdown(rows, tz, title, lang) {
  const out = [`# ${title}`, '', t(lang, 'export.md.count', { n: rows.length }), ''];
  let day = '';
  for (const r of rows) {
    const stamp = formatDateTime(new Date(r.date), tz, lang);
    const d = stamp.split(',')[0].trim();
    if (d !== day) { out.push('', `## ${d}`, ''); day = d; }
    const flags = marks(r, lang);
    const link = mirrorLinkOf(r);
    out.push(`- **${stamp}** · ${r.senderName ?? t(lang, 'common.contact')}${r.isOutgoing ? t(lang, 'export.md.me') : ''}: ${body(r).replace(/\n/g, ' ')}${flags.length ? ` _(${flags.join('; ')})_` : ''}${link ? ` [${t(lang, 'export.md.copy')}](${link})` : ''}`);
    for (const e of editsOf(r)) out.push(`  - ✏️ ${formatDateTime(new Date(e.editedAt), tz, lang)}: ${editLine(e, lang).replace(/\n/g, ' ')}`);
  }
  return out.join('\n');
}

function toHtml(rows, tz, title, lang) {
  const cells = rows.map((r) => {
    const link = mirrorLinkOf(r);
    const ed = editsOf(r);
    return `<tr class="${r.isDeleted ? 'del' : ''}">
<td>${escapeHtml(formatDateTime(new Date(r.date), tz, lang))}</td>
<td>${escapeHtml(r.chatName ?? String(r.chatId))}</td>
<td>${escapeHtml(r.senderName ?? '')}${r.senderUsername ? ` <span class="u">@${escapeHtml(r.senderUsername)}</span>` : ''}${r.isOutgoing ? ' 🙋' : ''}</td>
<td>${escapeHtml(kind(r, lang))}${link ? `<br><a href="${escapeHtml(link)}">${t(lang, 'export.html.copy')}</a>` : ''}</td>
<td>${escapeHtml(body(r))}${ed.length ? `<ol class="ed">${ed.map((e) => `<li><small>${escapeHtml(formatDateTime(new Date(e.editedAt), tz, lang))}</small> <del>${escapeHtml(e.oldText ?? '')}</del> → <ins>${escapeHtml(e.newText ?? '')}</ins></li>`).join('')}</ol>` : ''}</td>
<td>${escapeHtml(marks(r, lang).join('; '))}</td>
</tr>`;
  }).join('\n');
  return `<!doctype html>
<html lang="${normLang(lang)}"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
body{font:14px/1.45 system-ui,sans-serif;margin:24px;color:#111;background:#fff}
h1{font-size:20px} table{border-collapse:collapse;width:100%}
th,td{border:1px solid #ddd;padding:6px 8px;text-align:left;vertical-align:top}
th{background:#f5f5f5} tr.del td{background:#fff3f3} .u{color:#888} ol.ed{margin:6px 0 0;padding-left:18px;color:#555}
del{background:#ffe1e1} ins{background:#dcf5dc;text-decoration:none}
@media (prefers-color-scheme:dark){body{background:#111;color:#eee}th{background:#222}th,td{border-color:#333}tr.del td{background:#2a1a1a}del{background:#4a2020}ins{background:#1f3d22}ol.ed{color:#aaa}}
</style></head><body>
<h1>${escapeHtml(title)}</h1>
<p>${t(lang, 'export.html.count', { n: rows.length, tz: escapeHtml(tz) })}</p>
<table><thead><tr>${t(lang, 'export.html.th').split('|').map((c) => `<th>${c}</th>`).join('')}</tr></thead>
<tbody>
${cells}
</tbody></table>
</body></html>`;
}

/** @param {ExportFormat} format @param {any[]} rows @param {{ tz: string, title: string, scope: string, lang?: any }} opts lang — язык заголовков и пометок (по умолчанию ru) */
export function buildExport(format, rows, opts) {
  const content = format === 'json' ? toJson(rows)
    : format === 'csv' ? toCsv(rows, opts.tz, opts.lang)
    : format === 'md' ? toMarkdown(rows, opts.tz, opts.title, opts.lang)
    : toHtml(rows, opts.tz, opts.title, opts.lang);
  return { filename: `${opts.scope}.${EXT[format]}`, content, mime: mimeOf(format) };
}

const mimeOf = (f) => ({ json: 'application/json', csv: 'text/csv', md: 'text/markdown', html: 'text/html' })[f];

export const EXPORT_PERIODS = ['today', '7d', '30d', 'all'];
export const EXPORT_KINDS = ['all', 'deleted', 'edited', 'favorite', 'oneTime'];
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * @param {string} tz @param {{ format?: any, period?: any, kind?: any, chatId?: number | null, from?: any, to?: any }} o
 */
export function exportOptions(tz, o = {}) {
  const format = EXPORT_FORMATS.includes(o.format) ? o.format : 'json';
  const kind = EXPORT_KINDS.includes(o.kind) ? o.kind : 'all';
  const chatId = o.chatId ?? null;
  if (ISO.test(String(o.from ?? '')) && ISO.test(String(o.to ?? ''))) {
    const r = resolveRange({ from: o.from, to: o.to }, tz);
    return { format, kind, chatId, tz, from: r.from, to: r.to, period: /** @type {any} */ ('all'), label: `${o.from}_${o.to}` };
  }
  const period = EXPORT_PERIODS.includes(o.period) ? o.period : 'all';
  return { format, kind, chatId, tz, period, from: null, to: null, label: period };
}

export async function exportEstimate(owner, tz, o = {}) {
  const opts = exportOptions(tz, o);
  const rows = await countExport(owner, opts);
  return { rows: Math.min(rows, EXPORT_TOTAL_MAX), files: Math.max(1, Math.ceil(Math.min(rows, EXPORT_TOTAL_MAX) / EXPORT_MAX_ROWS)), truncated: rows > EXPORT_TOTAL_MAX };
}

async function withEdits(owner, rows) {
  const byPk = await editsForMessages(owner, rows.filter((r) => (r.editCount ?? 0) > 0).map((r) => r.id));
  return rows.map((r) => ({ ...r, edits: byPk.get(r.id) ?? [] }));
}

function buildParts(format, rows, base) {
  const built = buildExport(format, rows, base);
  const bytes = new TextEncoder().encode(built.content);
  if (bytes.length <= EXPORT_FILE_MAX_BYTES || rows.length <= 1) return [{ ...built, bytes, rows: rows.length }];
  const mid = Math.ceil(rows.length / 2);
  return [...buildParts(format, rows.slice(0, mid), base), ...buildParts(format, rows.slice(mid), base)];
}

/**
 * @param {number} owner @param {string} tz
 * @param {{ format?: any, period?: any, kind?: any, chatId?: number | null, from?: any, to?: any, lang?: any }} o lang — язык файла и подписей (не передан — из настроек владельца)
 * @param {{ pageSize?: number }} [tune] размер файла в строках (для тестов)
 */
export async function sendExport(owner, tz, o = {}, tune = {}) {
  const PAGE = tune.pageSize ?? EXPORT_MAX_ROWS;
  const lang = o.lang ?? (await langOf(owner));
  const opts = exportOptions(tz, o);
  await requirePro.exportFormat(owner, opts.format);
  const total = await countExport(owner, opts);
  if (total === 0) throw endpointError('err.emptyPeriod', null, 'EMPTY');
  const title = opts.chatId != null ? t(lang, 'export.titleChat', { name: (await chatTitle(owner, opts.chatId)) ?? opts.chatId }) : t(lang, 'export.title');
  const scope = opts.chatId != null ? `chat-${opts.chatId}-${opts.label}` : `archive-${opts.label}`;
  const planned = Math.ceil(Math.min(total, EXPORT_TOTAL_MAX) / PAGE);

  let cursor = /** @type {{ k: number, id: number } | null} */ (null), sentRows = 0, files = 0, firstName = null, lastId = null;
  for (let page = 1; sentRows < EXPORT_TOTAL_MAX; page++) {
    const { rows, next } = await exportPage(owner, opts, cursor, Math.min(PAGE, EXPORT_TOTAL_MAX - sentRows));
    if (!rows.length) break;
    const pageScope = planned > 1 ? `${scope}-${page}of${planned}` : scope;
    const parts = buildParts(opts.format, await withEdits(owner, rows), { tz, title, scope: pageScope, lang });
    for (const [i, part] of parts.entries()) {
      const filename = parts.length > 1 ? part.filename.replace(/(\.\w+)$/, `-${String.fromCharCode(97 + i)}$1`) : part.filename;
      const tail = planned > 1 ? t(lang, 'export.part', { page, planned }) : '';
      const sent = await api.sendDocument({
        chat_id: owner, document: new InputFile(part.bytes, filename),
        caption: t(lang, 'export.caption', { title, n: part.rows, format: opts.format.toUpperCase(), tail }),
      });
      files++; firstName ??= filename; lastId = sent.message_id;
    }
    sentRows += rows.length;
    if (!next) break;
    cursor = next;
  }
  const truncated = total > EXPORT_TOTAL_MAX;
  if (truncated) {
    await api.sendMessage({ chat_id: owner, text: t(lang, 'export.truncated', { max: EXPORT_TOTAL_MAX, total }) }).catch(() => {});
  }
  return { sent: true, messageId: lastId, rows: sentRows, files, filename: firstName, truncated };
}
