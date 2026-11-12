import { updateHandler, reporter } from '../lib/runtime.js';
import { onEdit, notifyEdited, drainOutbox } from '../lib/events.js';
import { drainMirror } from '../lib/archive.js';
import { drainJobs } from '../lib/jobs.js';

export default updateHandler(async (m, ctx) => {
  const connId = ctx?.update?.edited_business_message?.business_connection_id ?? m?.business_connection_id;
  if (!m || !connId) return null;
  const res = await onEdit(m, connId);
  if (!res) return null;
  await notifyEdited(res.owner, res, res.tz).catch(reporter('notifyEdited', res.owner));
  await drainMirror(res.owner, res.tz, new Date(), 5, 5, Infinity, res.lang).catch(reporter('drainMirror', res.owner));
  await drainOutbox(res.owner).catch(reporter('drainOutbox', res.owner));
  await drainJobs(res.owner, res.tz, new Date(), 1, res.lang).catch(reporter('drainJobs', res.owner));
  return { changed: res.changed ?? res.created ?? false };
});
