import { updateHandler, reporter } from '../lib/runtime.js';
import { onConnection, notifyConnected, notifyDisconnected } from '../lib/events.js';

export default updateHandler(async (bc) => {
  if (!bc) return null;
  const v = await onConnection(bc);
  // Тот же апдейт приходит и при отключении (is_enabled=false) — не пишем «Подключено».
  if (v.isEnabled) await notifyConnected(v.ownerUserId).catch(reporter('notifyConnected', v.ownerUserId));
  else await notifyDisconnected(v.ownerUserId).catch(reporter('notifyDisconnected', v.ownerUserId));
  return v;
});
