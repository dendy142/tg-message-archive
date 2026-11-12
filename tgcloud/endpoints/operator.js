import { endpointError } from '../lib/i18n.js';
import { authed, recentErrors } from '../lib/runtime.js';
import { isOperator, operatorStats } from '../lib/admin.js';

export default authed(async (_input, { owner }) => {
  if (!(await isOperator(owner))) throw endpointError('err.notFound', null, 'NOT_FOUND');
  const errors = (await recentErrors(50)).map((e) => ({ ...e, at: new Date(e.at).getTime() }));
  return { stats: await operatorStats(), errors };
});
