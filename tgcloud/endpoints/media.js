import { authed, parseCursor, requireOwnChat } from '../lib/runtime.js';
import { mediaPage } from '../lib/repo/messages.js';
import { eventView } from '../lib/view.js';

const GROUPS = new Set(['all', 'photo', 'video', 'voice', 'document']);

export default authed(async (input, { owner, settings }) => {
  const group = GROUPS.has(input.group) ? input.group : 'all';
  const chatId = input.chatId != null ? await requireOwnChat(owner, input.chatId) : null;
  const { rows, next } = await mediaPage(owner, {
    group, chatId, deletedOnly: !!input.deletedOnly, cursor: parseCursor(input.cursor), limit: input.limit ?? 60,
  });
  return { items: rows.map((r) => eventView(r, settings.lang)), next };
});
