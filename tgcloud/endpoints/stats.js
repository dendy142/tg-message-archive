import { authed, requireOwnChat } from '../lib/runtime.js';
import { overall, mediaBreakdown } from '../lib/repo/messages.js';
import { resolveRange, dayKeys, periodTimes, ensureDailyBuilt } from '../lib/repo/chats.js';
import { bucketByDay, statsFromDaily } from '../lib/insights.js';
import { localClock } from '../lib/util.js';
import { mediaLabel } from '../lib/media.js';

export default authed(async (input, { owner, settings }) => {
  const chatId = input.chatId != null ? await requireOwnChat(owner, input.chatId) : null;
  const range = resolveRange(input, settings.timezone);
  if (await ensureDailyBuilt(settings)) return statsFromDaily(owner, settings.timezone, range, chatId, settings.lang);
  const clock = localClock(settings.timezone);
  const [totals, cur, prev, media] = await Promise.all([
    overall(owner, chatId),
    periodTimes(owner, range, chatId),
    periodTimes(owner, { from: range.prevFrom, to: range.prevTo }, chatId),
    mediaBreakdown(owner, chatId),
  ]);
  const series = (p) => ({ captured: p.created, deleted: p.deleted.map((d) => d.t), edited: p.edited });
  const activity = bucketByDay(dayKeys(range.from, range.days, clock), series(cur), clock);
  const prevActivity = bucketByDay(dayKeys(range.prevFrom, range.days, clock), series(prev), clock);

  const byChat = new Map();
  for (const d of cur.deleted) {
    const c = byChat.get(d.chatId) ?? { chatId: d.chatId, chatName: d.chatName, deleted: 0 };
    c.deleted++;
    if (d.chatName) c.chatName = d.chatName;
    byChat.set(d.chatId, c);
  }
  const topChats = chatId == null ? [...byChat.values()].sort((a, b) => b.deleted - a.deleted).slice(0, 8) : [];

  return {
    totals,
    period: { captured: cur.created.length, deleted: cur.deleted.length, edited: cur.edited.length },
    prev: { captured: prev.created.length, deleted: prev.deleted.length, edited: prev.edited.length },
    activity,
    prevActivity,
    topChats,
    media: media.map((m) => ({ ...m, label: mediaLabel(m.type, settings.lang) })),
    days: range.days,
    range: { from: range.from.getTime(), to: range.to.getTime(), prevFrom: range.prevFrom.getTime() },
    chatId,
  };
}, { limit: 'stats' });
