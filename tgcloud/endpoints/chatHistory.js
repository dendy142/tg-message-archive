import { authed, parseCursor, requireOwnChat } from '../lib/runtime.js';
import { chatPage, editsForMessages, chatTitle, cursorForDay, CHAT_FILTERS } from '../lib/repo/messages.js';
import { chatPref } from '../lib/repo/state.js';
import { getChat } from '../lib/repo/chats.js';

/** Бизнес-бот отвечает только в течение 24 часов после последнего входящего. */
const REPLY_WINDOW_MS = 24 * 3_600_000;
import { eventView, editView } from '../lib/view.js';
import { parseUserDate } from '../lib/util.js';
import { endpointError } from '../lib/i18n.js';

export default authed(async (input, { owner, settings }) => {
  const chatId = await requireOwnChat(owner, input.chatId);
  const filter = CHAT_FILTERS.includes(input.filter) ? input.filter : 'all';
  if (input.jumpTo) {
    const day = parseUserDate(String(input.jumpTo), settings.timezone);
    if (!day) throw endpointError('err.badDate', null, 'BAD_DATE');
    const cursor = await cursorForDay(owner, chatId, day, settings.timezone, filter);
    return { jump: cursor };
  }
  const { rows, hasOlder, hasNewer } = await chatPage(owner, chatId, {
    before: parseCursor(input.before), after: parseCursor(input.after), limit: input.limit ?? 50, filter,
  });
  const editsByPk = await editsForMessages(owner, rows.map((r) => r.id));
  const [title, pref, chat] = await Promise.all([chatTitle(owner, chatId), chatPref(owner, chatId), getChat(owner, chatId)]);
  const lastIn = chat?.lastIncomingAt ? new Date(chat.lastIncomingAt).getTime() : 0;
  return {
    chatId, chatName: title,
    muted: !!pref?.muted, autoRead: !!pref?.autoRead,
    replyWindowOpen: Date.now() - lastIn < REPLY_WINDOW_MS,
    replyWindowUntil: lastIn ? lastIn + REPLY_WINDOW_MS : null,
    items: rows.map((r) => ({ ...eventView(r, settings.lang), edits: (editsByPk.get(r.id) ?? []).map(editView) })),
    hasOlder, hasNewer,
  };
});
