import { authed } from '../lib/runtime.js';
import { invoiceLink } from '../lib/plans.js';

export default authed(async (_input, { owner, settings }) => invoiceLink(owner, settings.lang));
