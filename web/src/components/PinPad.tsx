import { useEffect, useState } from 'react';
import { haptic } from '../telegram';
import { Icon } from './Icon';
import { t } from '../i18n';

export function PinPad({ onSubmit, busy, error, min = 4, max = 6, resetKey }: {
  onSubmit: (pin: string) => void; busy?: boolean; error?: string | null; min?: number; max?: number; resetKey?: unknown;
}) {
  const [v, setV] = useState('');
  useEffect(() => { setV(''); }, [resetKey]);
  const press = (d: string) => {
    if (busy || v.length >= max) return;
    haptic('light');
    const next = v + d;
    setV(next);
    if (next.length === max) onSubmit(next);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') setV((x) => x.slice(0, -1));
      else if (e.key === 'Enter' && v.length >= min) onSubmit(v);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  return (
    <div className="pinpad">
      <div className={`pin-dots${error ? ' err' : ''}`} aria-label={t('lock.digits', { n: v.length })}>
        {Array.from({ length: Math.max(min, v.length) }, (_, i) => <i key={i} className={i < v.length ? 'on' : ''} />)}
      </div>
      <div className="pin-msg">{error ?? ' '}</div>
      <div className="pin-keys">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => <button key={d} onClick={() => press(d)} disabled={busy}>{d}</button>)}
        <button className="aux" onClick={() => setV((x) => x.slice(0, -1))} disabled={busy || !v} aria-label={t('lock.erase')}><Icon name="close" /></button>
        <button onClick={() => press('0')} disabled={busy}>0</button>
        <button className="aux" onClick={() => onSubmit(v)} disabled={busy || v.length < min} aria-label={t('common.done')}><Icon name="check" strokeWidth={2.4} /></button>
      </div>
    </div>
  );
}
