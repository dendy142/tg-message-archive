import { authed, requireOwnChat, rateLimit } from '../lib/runtime.js';
import { sendExport, exportEstimate } from '../lib/export.js';

export default authed(async (input, { owner, settings }) => {
  const chatId = input.chatId != null ? await requireOwnChat(owner, input.chatId) : null;
  const o = { format: input.format, period: input.period, kind: input.kind, chatId, from: input.from, to: input.to, lang: settings.lang };
  if (input.estimate) return exportEstimate(owner, settings.timezone, o);
  await rateLimit(owner, 'export');
  return sendExport(owner, settings.timezone, o);
});
