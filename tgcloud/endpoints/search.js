import { authed, parseCursor, requireOwnChat } from '../lib/runtime.js';
import { search } from '../lib/repo/messages.js';
import { eventView } from '../lib/view.js';

const KINDS = new Set(['events', 'deleted', 'edited', 'favorite', 'all']);

export default authed(async (input, { owner, settings }) => {
  const q = String(input.q ?? '').trim();
  if (!q) return { items: [], next: null, total: 0, query: '' };
  const kind = KINDS.has(input.kind) ? input.kind : 'all';
  const { rows, next, total } = await search(owner, q, {
    kind, tz: settings.timezone, chatId: input.chatId != null ? await requireOwnChat(owner, input.chatId) : null,
    cursor: parseCursor(input.cursor), limit: input.limit ?? 30,
  });
  return { items: rows.map((r) => eventView(r, settings.lang)), next, total, query: q };
}, { limit: 'search' });
