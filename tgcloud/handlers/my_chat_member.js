import { updateHandler } from '../lib/runtime.js';
import { onBotMembershipChange } from '../lib/archive.js';

export default updateHandler(async (upd) => onBotMembershipChange(upd));
