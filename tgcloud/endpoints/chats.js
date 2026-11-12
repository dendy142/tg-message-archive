import { authed } from '../lib/runtime.js';
import { listChats, countChats } from '../lib/repo/messages.js';
import { chatView } from '../lib/view.js';

export default authed(async (input, { owner, settings }) => {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const offset = Math.max(input.offset ?? 0, 0);
  const [chats, total] = await Promise.all([listChats(owner, { limit, offset, unreadSince: settings.lastSeenEventsAt ?? null }), countChats(owner)]);
  return { items: chats.map(chatView), total, offset, limit };
});
