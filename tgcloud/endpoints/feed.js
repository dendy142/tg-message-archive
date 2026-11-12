import { authed, parseCursor, requireOwnChat } from '../lib/runtime.js';
import { feed, countFeed } from '../lib/repo/messages.js';
import { eventView } from '../lib/view.js';

const KINDS = new Set(['events', 'deleted', 'edited', 'favorite', 'oneTime', 'all']);
const DIRS = new Set(['any', 'in', 'out']);
const MEDIA = new Set(['any', 'text', 'media', 'photo', 'video', 'voice', 'document', 'sticker']);
const PERIODS = new Set(['today', '7d', '30d', 'all']);

export default authed(async (input, { owner, settings }) => {
  const kind = KINDS.has(input.kind) ? input.kind : 'events';
  const direction = DIRS.has(input.direction) ? input.direction : 'any';
  const media = MEDIA.has(input.media) ? input.media : 'any';
  const period = PERIODS.has(input.period) ? input.period : 'all';
  const chatId = input.chatId != null ? await requireOwnChat(owner, input.chatId) : null;
  const opts = { ownerUserId: owner, kind, direction, media, period, tz: settings.timezone, chatId };
  if (input.since != null && Number.isFinite(input.since)) {
    const { rows } = await feed({ ...opts, since: Number(input.since), limit: 50 });
    return { items: rows.map((r) => eventView(r, settings.lang)), next: null, live: true };
  }
  const [{ rows, next }, total] = await Promise.all([
    feed({ ...opts, cursor: parseCursor(input.cursor), limit: input.limit ?? 30 }),
    input.cursor ? Promise.resolve(null) : countFeed(opts),
  ]);
  return { items: rows.map((r) => eventView(r, settings.lang)), next, total };
});
