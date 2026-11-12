import { updateHandler, reporter } from '../lib/runtime.js';
import { onDelete, notifyDeleted, drainOutbox } from '../lib/events.js';
import { drainMirror } from '../lib/archive.js';
import { drainJobs } from '../lib/jobs.js';

export default updateHandler(async (d, ctx) => {
  const connId = ctx?.update?.deleted_business_messages?.business_connection_id ?? d?.business_connection_id;
  if (!d || !connId) return null;
  const res = await onDelete(d, connId);
  if (!res || (res.transitioned.length === 0 && !res.missing?.length)) return null;
  await notifyDeleted(res.owner, res, res.tz).catch(reporter('notifyDeleted', res.owner));
  // Подписи копий уже помечены dirty в markDeletedMany — перерисуем их в «удалено».
  await drainMirror(res.owner, res.tz, new Date(), 5, 5, Infinity, res.lang).catch(reporter('drainMirror', res.owner));
  await drainOutbox(res.owner).catch(reporter('drainOutbox', res.owner));
  await drainJobs(res.owner, res.tz, new Date(), 1, res.lang).catch(reporter('drainJobs', res.owner));
  return { deleted: res.transitioned.length, wipe: res.wipe };
});
