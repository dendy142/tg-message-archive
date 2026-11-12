// Лист снизу вместо Telegram.showPopup: тот принимает не больше трёх кнопок (WebAppPopupParamInvalid).
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useBackButton, haptic } from '../telegram';
import type { ChoiceSpec } from '../nav';
import { Cell } from './ui';
import { Icon } from './Icon';
import { t } from '../i18n';

export function Sheet({ open, onClose, title, message, children }: {
  open: boolean; onClose: () => void; title?: ReactNode; message?: ReactNode; children: ReactNode;
}) {
  const [shown, setShown] = useState(open);
  const [closing, setClosing] = useState(false);
  const shownRef = useRef(shown);
  shownRef.current = shown;

  useEffect(() => {
    if (open) { setShown(true); setClosing(false); return; }
    if (!shownRef.current) return;
    setClosing(true);
    const t = setTimeout(() => { setShown(false); setClosing(false); }, 190);
    return () => clearTimeout(t);
  }, [open]);

  useBackButton(open ? onClose : null);

  useEffect(() => {
    if (!shown) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [shown]);

  if (!shown) return null;
  return (
    <div className={`sheet-wrap${closing ? ' closing' : ''}`} role="dialog" aria-modal="true">
      <div className="sheet-ov" onClick={onClose} />
      <div className="sheet">
        <div className="grab" />
        {title && <div className="sh-t">{title}</div>}
        {message && <div className="sh-m">{message}</div>}
        <div className="sh-body">{children}</div>
      </div>
    </div>
  );
}

export function ChoiceList<T>({ spec, onPick }: { spec: ChoiceSpec<T>; onPick: (v: T | null) => void }) {
  const picking = spec.selected !== undefined;
  return (
    <>
      <div className="sec">
        {spec.options.map((o, i) => (
          <Cell key={i} icon={o.icon} title={o.label} sub={o.hint} tone={o.tone ?? (picking ? undefined : 'accent')}
            onClick={() => { haptic('select'); onPick(o.value); }}
            right={picking && Object.is(o.value, spec.selected) ? <Icon name="check" className="check" strokeWidth={2.4} /> : undefined} />
        ))}
      </div>
      <div className="pad" style={{ marginTop: 10 }}>
        <button className="btn tinted" onClick={() => onPick(null)}>{t('common.cancel')}</button>
      </div>
    </>
  );
}
