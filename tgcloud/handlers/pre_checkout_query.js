// Telegram ждёт ответа не дольше 10 секунд
import { api } from 'sdk';
import { updateHandler } from '../lib/runtime.js';
import { checkPreCheckout } from '../lib/plans.js';

export default updateHandler(async (q) => {
  if (!q?.id) return null;
  const r = await checkPreCheckout(q);
  await api.answerPreCheckoutQuery({ pre_checkout_query_id: q.id, ok: r.ok, ...(r.ok ? {} : { error_message: r.error }) });
  return r;
});
