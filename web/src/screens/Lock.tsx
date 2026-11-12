// Замок: PIN проверяется на сервере с паузой после неудач.
import { useEffect, useRef, useState } from 'react';
import { tg, haptic } from '../telegram';
import { call, ApiError } from '../api';
import { Icon } from '../components/Icon';
import { PinPad } from '../components/PinPad';
import { t } from '../i18n';

export function Lock({ mode, onUnlock }: { mode: 'biometric' | 'pin'; onUnlock: () => void }) {
  const [bio, setBio] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [lockedUntil, setLockedUntil] = useState(0);
  const [tick, setTick] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const auto = useRef(false);
  const pinMode = mode === 'pin';

  const biometric = (fallback: () => void) => {
    const bm = tg?.BiometricManager;
    if (!bio || !bm) { fallback(); return; }
    setBusy(true); setMsg(null);
    const auth = () => bm.authenticate({ reason: t('lock.bioReason') }, (ok) => {
      setBusy(false);
      if (ok) { haptic('success'); onUnlock(); } else { haptic('error'); setMsg(pinMode ? t('lock.bioFailPin') : t('lock.bioFail')); }
    });
    try {
      if (bm.isAccessGranted) auth();
      else bm.requestAccess({ reason: t('lock.bioRequest') }, (granted) => (granted ? auth() : (setBusy(false), fallback())));
    } catch { setBusy(false); fallback(); }
  };
  // Без PIN и без биометрии замок только прячет архив от случайного взгляда.
  const unlockSimple = () => biometric(() => { haptic('success'); onUnlock(); });

  useEffect(() => {
    const bm = tg?.BiometricManager;
    if (!bm) { setBio(false); return; }
    const ready = () => setBio(!!bm.isBiometricAvailable);
    try { if (bm.isInited) ready(); else bm.init(ready); } catch { setBio(false); }
  }, []);

  const bioRef = useRef(biometric);
  bioRef.current = biometric;
  useEffect(() => {
    if (bio && !auto.current && tg?.BiometricManager?.isAccessGranted) {
      auto.current = true;
      bioRef.current(pinMode ? () => {} : () => { haptic('success'); onUnlock(); });
    }
  }, [bio, pinMode, onUnlock]);

  useEffect(() => {
    if (lockedUntil <= Date.now()) return;
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [lockedUntil, tick]);
  const waitSec = Math.max(0, Math.ceil((lockedUntil - Date.now()) / 1000));

  const submitPin = async (pin: string) => {
    setBusy(true); setMsg(null);
    try {
      const r = await call<{ ok: boolean; lockedUntilMs?: number | null; left?: number }>('pin', { verify: true, pin });
      if (r.ok) { haptic('success'); onUnlock(); return; }
      haptic('error');
      setAttempt((a) => a + 1);
      if (r.lockedUntilMs) setLockedUntil(r.lockedUntilMs);
      setMsg(r.left ? t('lock.wrongPinLeft', { left: r.left }) : t('lock.wrongPin'));
    } catch (e) { setMsg((e as ApiError).message); setAttempt((a) => a + 1); }
    finally { setBusy(false); }
  };

  const kind = tg?.BiometricManager?.biometricType === 'face' ? 'Face ID' : t('lock.fingerprint');
  if (pinMode) {
    return (
      <div className="center-screen">
        <div className="logo lock"><Icon name="lock" strokeWidth={1.8} /></div>
        <h1 className="h1">{t('lock.enterPin')}</h1>
        {waitSec > 0
          ? <p className="lead">{t('lock.tooMany', { n: waitSec })}</p>
          : <PinPad onSubmit={submitPin} busy={busy} error={msg} resetKey={attempt} />}
        {bio && <button className="btn plain small" style={{ marginTop: 8 }} onClick={() => biometric(() => {})}><Icon name="fingerprint" />{kind}</button>}
        <p className="hint" style={{ fontSize: 13, marginTop: 14 }}>{t('lock.forgot')}</p>
      </div>
    );
  }
  return (
    <div className="center-screen">
      <div className="logo lock"><Icon name="lock" strokeWidth={1.8} /></div>
      <h1 className="h1">{t('lock.locked')}</h1>
      <p className="lead">{bio ? t('lock.confirm', { kind }) : bio === false ? t('lock.noBio') : ' '}</p>
      {msg && <div className="note warn" style={{ marginTop: 16 }}><Icon name="alert" />{msg}</div>}
      <button className="btn" style={{ maxWidth: 280, marginTop: 28 }} disabled={busy || bio === null} onClick={unlockSimple}>
        <Icon name={bio ? 'fingerprint' : 'unlock'} />{busy ? t('lock.checking') : bio ? t('lock.unlock') : t('lock.open')}
      </button>
    </div>
  );
}
