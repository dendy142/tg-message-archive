// PIN-замок Mini App. Это защита от чужого взгляда, а не шифрование архива
import { endpointError } from '../lib/i18n.js';
import { authed } from '../lib/runtime.js';
import { updateSettings } from '../lib/repo/state.js';
import { hashPin, checkPin, newSalt } from '../lib/util.js';
import { settingsView } from '../lib/view.js';
import { requirePro } from '../lib/plans.js';

const PIN = /^\d{4,6}$/;
export const FREE_TRIES = 5;
const MAX_LOCK_MS = 30 * 60_000;

/** @param {number} failed */
export const lockFor = (failed) => (failed < FREE_TRIES ? 0 : Math.min(MAX_LOCK_MS, 60_000 * 2 ** (failed - FREE_TRIES)));

export default authed(async (input, { owner, settings: s }) => {
  const now = Date.now();
  const lockedUntil = s.pinLockedUntil ? new Date(s.pinLockedUntil).getTime() : 0;
  const verify = async (pin) => {
    if (!s.pinHash) return { ok: true };
    if (lockedUntil > now) return { ok: false, lockedUntilMs: lockedUntil, left: 0 };
    if (checkPin(String(pin ?? ''), s.pinSalt ?? '', s.pinHash)) {
      if (s.pinFailed) await updateSettings(owner, { pinFailed: 0, pinLockedUntil: null });
      return { ok: true };
    }
    const failed = (s.pinFailed ?? 0) + 1;
    const wait = lockFor(failed);
    await updateSettings(owner, { pinFailed: failed, pinLockedUntil: wait ? new Date(now + wait) : null });
    return { ok: false, lockedUntilMs: wait ? now + wait : null, left: Math.max(0, FREE_TRIES - failed) };
  };

  if (input.verify) return verify(input.pin);

  if (input.set) {
    await requirePro.pin(owner);
    if (!PIN.test(String(input.pin ?? ''))) throw endpointError('err.pinFormat', null, 'BAD_PIN');
    if (s.pinHash) {
      const v = await verify(input.current);
      if (!v.ok) throw endpointError('err.pinCurrentWrong', null, 'WRONG_PIN', { ...v });
    }
    const salt = newSalt();
    const row = await updateSettings(owner, { pinHash: hashPin(String(input.pin), salt), pinSalt: salt, pinFailed: 0, pinLockedUntil: null, lockMode: 'pin', lockEnabled: true });
    return { ok: true, settings: settingsView(row) };
  }

  if (input.clear) {
    const v = await verify(input.pin);
    if (!v.ok) throw endpointError('err.pinWrong', null, 'WRONG_PIN', { ...v });
    const mode = input.mode === 'off' ? 'off' : 'biometric';
    const row = await updateSettings(owner, { pinHash: null, pinSalt: null, pinFailed: 0, pinLockedUntil: null, lockMode: mode, lockEnabled: mode !== 'off' });
    return { ok: true, settings: settingsView(row) };
  }
  throw endpointError('err.badAction', null, 'BAD_ACTION');
}, { limit: 'pin' });
