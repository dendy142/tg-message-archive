import type { DiffPart } from '../types';
import { t } from '../i18n';

export function Diff({ parts }: { parts: DiffPart[] }) {
  if (!parts.length) return <div className="diff hint"><i>{t('ui.diff.empty')}</i></div>;
  return (
    <div className="diff">
      {parts.map((p, i) =>
        p.op === 'eq' ? <span key={i}>{p.text}</span>
          : p.op === 'del' ? <del key={i}>{p.text}</del>
            : <ins key={i}>{p.text}</ins>)}
    </div>
  );
}
