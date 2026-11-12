import { authed, report } from '../lib/runtime.js';

export default authed(async (input, { owner }) => {
  const where = `client: ${String(input.where ?? 'app').slice(0, 200)}`;
  const e = { message: String(input.message ?? 'unknown').slice(0, 1000), stack: typeof input.stack === 'string' ? input.stack.slice(0, 4000) : undefined };
  return { recorded: await report(where, e, owner) };
}, { limit: 'clientError' });
