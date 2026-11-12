import { updateHandler, sendView } from '../lib/runtime.js';
import { linkArchiveFromShare } from '../lib/archive.js';
import { runCommand } from '../lib/commands.js';
import '../lib/admin.js'; // регистрирует скрытую /admin
import { recordPayment } from '../lib/plans.js';
import { escapeHtml, h, p, blocks, footer } from '../lib/text.js';
import { openOnly } from '../lib/links.js';
import { langOf } from '../lib/repo/state.js';
import { t, localeOf } from '../lib/i18n.js';

export default updateHandler(async (m) => {
  if (m?.chat_shared) return linkArchiveFromShare(m);
  const chatId = m?.chat?.id;
  if (chatId == null || m.chat?.type !== 'private') return null;
  if (m.successful_payment) {
    const r = await recordPayment(Number(chatId), m.successful_payment);
    if (r) {
      const lang = await langOf(Number(chatId), m.from?.language_code);
      const until = new Date(r.expiresAt).toLocaleDateString(localeOf(lang), { day: 'numeric', month: 'long', year: 'numeric' });
      await sendView(chatId, { html: blocks(h(3, t(lang, 'plans.paid.title')), p(escapeHtml(t(lang, 'plans.paid.body', { until })))) }).catch(() => {});
    }
    return { payment: !!r };
  }
  if (await runCommand(Number(chatId), m)) return { command: true };
  const lang = await langOf(Number(chatId), m.from?.language_code);
  await sendView(chatId, {
    html: blocks(h(3, t(lang, 'bot.hint.title')), p(t(lang, 'bot.hint.body')), footer(t(lang, 'bot.hint.footer', { path: t(lang, 'bot.connectPath') }))),
    reply_markup: await openOnly(lang),
  }).catch(() => {});
  return null;
});
