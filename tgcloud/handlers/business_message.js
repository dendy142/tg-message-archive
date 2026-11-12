import { updateHandler, maybeOwnerHousekeeping, reporter } from '../lib/runtime.js';
import { onNewMessage, notifyKeyword, notifyOneTime, notifyRename, drainOutbox } from '../lib/events.js';
import { drainMirror } from '../lib/archive.js';
import { drainJobs } from '../lib/jobs.js';
import { refreshAvatar } from '../lib/links.js';

export default updateHandler(async (m, ctx) => {
  const connId = ctx?.update?.business_message?.business_connection_id ?? m?.business_connection_id;
  if (!m || !connId) return null;
  const res = await onNewMessage(m, connId);
  if (!res) return null;
  if (res.oneTime) await notifyOneTime(res.owner, res.oneTime, res.tz).catch(reporter('notifyOneTime', res.owner));
  if (res.keywordHits.length) await notifyKeyword(res.owner, res.saved, res.keywordHits, res.tz).catch(reporter('notifyKeyword', res.owner));
  if (res.rename) await notifyRename(res.owner, res.rename, res.tz).catch(reporter('notifyRename', res.owner));
  await drainMirror(res.owner, res.tz, new Date(), 5, 5, Infinity, res.lang).catch(reporter('drainMirror', res.owner));
  await drainOutbox(res.owner).catch(reporter('drainOutbox', res.owner));
  await drainJobs(res.owner, res.tz, new Date(), 1, res.lang).catch(reporter('drainJobs', res.owner));
  await maybeOwnerHousekeeping(res.owner).catch(reporter('retention', res.owner));
  if (res.saved && !res.saved.isOutgoing) await refreshAvatar(res.owner, Number(res.saved.chatId)).catch(() => null);
  return { saved: res.saved?.id, keywordHits: res.keywordHits };
});
