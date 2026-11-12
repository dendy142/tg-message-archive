import { authed, requireOwnChat } from '../lib/runtime.js';
import { resolveRange, periodMessages, periodDeleted, periodEdits, ensureDailyBuilt } from '../lib/repo/chats.js';
import { heatmap, nightShare, timeToDelete, deletionBursts, wipeChronicle, regretIndex, editorsAndRewritten, balance, topWords, deletedByType, records, mediaTotals, insightsFromDaily } from '../lib/insights.js';
import { localClock } from '../lib/util.js';

export default authed(async (input, { owner, settings }) => {
  const chatId = input.chatId != null ? await requireOwnChat(owner, input.chatId) : null;
  const range = resolveRange(input, settings.timezone);
  if (await ensureDailyBuilt(settings)) return insightsFromDaily(owner, settings.timezone, range, chatId, settings.lang);
  const clock = localClock(settings.timezone);
  const [msgs, del, ed] = await Promise.all([
    periodMessages(owner, range, chatId),
    periodDeleted(owner, range, chatId),
    periodEdits(owner, range, chatId),
  ]);
  const incomingDeleted = del.rows.filter((r) => !r.isOutgoing);
  const incomingEdits = ed.edits.filter((e) => !ed.byPk.get(e.messagePk)?.isOutgoing);
  const bursts = deletionBursts(del.rows);
  const { editors, rewritten } = editorsAndRewritten(ed.edits, ed.byPk);
  const bal = balance(msgs.rows);

  return {
    days: range.days,
    heatmap: {
      deleted: heatmap(incomingDeleted.map((r) => r.deletedAt), clock),
      edited: heatmap(incomingEdits.map((e) => e.editedAt), clock),
    },
    night: nightShare(incomingDeleted.map((r) => r.deletedAt), clock),
    ttd: timeToDelete(incomingDeleted, settings.lang),
    wipes: wipeChronicle(bursts),
    regret: regretIndex(msgs.rows, chatId == null ? 10 : 1),
    editors,
    rewritten,
    balance: bal,
    words: topWords(incomingDeleted.map((r) => r.text ?? r.caption)),
    deletedByType: deletedByType(msgs.rows),
    records: records(msgs.rows, del.rows, bursts, clock),
    media: mediaTotals(msgs.rows, del.rows),
    truncated: msgs.truncated || del.truncated,
  };
}, { limit: 'insights' });
