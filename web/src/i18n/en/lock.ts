import type { Translation } from '../ru';
import type { lock as ru } from '../ru/lock';

export const lock: Translation<typeof ru> = {
  'lock.bioReason': 'Access to the archive',
  'lock.bioRequest': 'Unlock the archive',
  'lock.bioFailPin': 'Failed — enter your PIN',
  'lock.bioFail': 'Couldn\'t verify. Try again.',
  'lock.wrongPinLeft': 'Wrong PIN. {left} {left|attempt|attempts} left',
  'lock.wrongPin': 'Wrong PIN',
  'lock.fingerprint': 'fingerprint',
  'lock.enterPin': 'Enter PIN',
  'lock.tooMany': 'Too many attempts. Try again in {n} s.',
  'lock.forgot': 'Forgot your PIN? Send /pin_reset to the bot.',
  'lock.locked': 'Archive locked',
  'lock.confirm': 'Confirm with {kind}.',
  'lock.noBio': 'Biometrics aren\'t available on this device — the lock only hides the archive from a casual glance. For real protection, set a PIN in Settings.',
  'lock.checking': 'Checking…',
  'lock.unlock': 'Unlock',
  'lock.open': 'Open',
  'lock.digits': 'Digits entered: {n}',
  'lock.erase': 'Delete',
  'lock.crash.title': 'Something went wrong',
  'lock.crash.text': 'We\'ve received the error report. Restart the app — your archive is safe.',
  'lock.crash.restart': 'Restart',
};
