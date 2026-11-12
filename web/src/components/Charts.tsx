import { useState, type ReactNode } from 'react';
import { fmtNum } from '../util';
import { t, pluralForm, type Key } from '../i18n';

const WEEKDAYS: Key[] = ['charts.wd.mon', 'charts.wd.tue', 'charts.wd.wed', 'charts.wd.thu', 'charts.wd.fri', 'charts.wd.sat', 'charts.wd.sun'];
const WEEKDAYS_LONG: Key[] = ['charts.wdLong.mon', 'charts.wdLong.tue', 'charts.wdLong.wed', 'charts.wdLong.thu', 'charts.wdLong.fri', 'charts.wdLong.sat', 'charts.wdLong.sun'];

/** @param grid 7×24, понедельник первым */
export function Heatmap({ grid, color, unit }: { grid: number[][]; color: string; unit: string }) {
  const [sel, setSel] = useState<{ d: number; h: number } | null>(null);
  const max = Math.max(1, ...grid.flat());
  const level = (v: number) => (v === 0 ? 0 : Math.min(4, Math.ceil((v / max) * 4)));
  const shade = (l: number) => (l === 0 ? 'var(--fill-2)' : `color-mix(in srgb, ${color} ${[0, 28, 50, 74, 100][l]}%, var(--surface))`);
  const v = sel ? grid[sel.d][sel.h] : null;
  const pl = (n: number) => pluralForm(n, unit);
  return (
    <div className="heat">
      <div className="heat-cap">
        {sel ? <><b className="tnum">{fmtNum(v!)}</b> {pl(v!)} · {t(WEEKDAYS_LONG[sel.d])}, {String(sel.h).padStart(2, '0')}:00–{String((sel.h + 1) % 24).padStart(2, '0')}:00</>
          : <span className="hint">{t('charts.heat.hint')}</span>}
      </div>
      <div className="heat-grid" role="grid">
        {grid.map((row, d) => (
          <div key={d} className="heat-row" role="row">
            <span className="heat-wd">{t(WEEKDAYS[d])}</span>
            {row.map((n, h) => (
              <button key={h} role="gridcell" className={`heat-cell${sel?.d === d && sel.h === h ? ' sel' : ''}`}
                style={{ background: shade(level(n)) }} onClick={() => setSel(sel?.d === d && sel.h === h ? null : { d, h })}
                aria-label={`${t(WEEKDAYS_LONG[d])}, ${h}:00 — ${n}`} />
            ))}
          </div>
        ))}
        <div className="heat-row heat-hours" aria-hidden="true">
          <span className="heat-wd" />
          {Array.from({ length: 24 }, (_, h) => <span key={h} className="heat-h">{h % 6 === 0 ? h : ''}</span>)}
        </div>
      </div>
      <div className="heat-legend" aria-hidden="true">
        {t('charts.heat.less')} {[0, 1, 2, 3, 4].map((l) => <i key={l} style={{ background: shade(l) }} />)} {t('charts.heat.more')}
      </div>
    </div>
  );
}

export function BarList({ items, color }: { items: { key: string; label: ReactNode; value: number; note?: ReactNode }[]; color: string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="barlist">
      {items.map((i) => (
        <div key={i.key} className="bl-row">
          <div className="bl-top"><span className="bl-l">{i.label}</span><span className="bl-v tnum">{i.note ?? fmtNum(i.value)}</span></div>
          <div className="bl-track"><i style={{ width: `${(i.value / max) * 100}%`, background: color, minWidth: i.value ? 4 : 0 }} /></div>
        </div>
      ))}
    </div>
  );
}

export function SplitBar({ a, b }: { a: number; b: number }) {
  const sum = a + b || 1;
  return (
    <div className="split" aria-label={t('charts.split.aria', { a, b })}>
      <i style={{ width: `${(a / sum) * 100}%`, background: 'var(--blue)' }} />
      <i style={{ width: `${(b / sum) * 100}%`, background: 'var(--aqua)' }} />
    </div>
  );
}

export function WordCloud({ words, onPick }: { words: { word: string; count: number }[]; onPick: (w: string) => void }) {
  const max = Math.max(1, ...words.map((w) => w.count));
  const min = Math.min(...words.map((w) => w.count));
  const size = (c: number) => 13 + (max === min ? 4 : ((c - min) / (max - min)) * 15);
  const list = [...words].sort((a, b) => a.word.localeCompare(b.word));
  return (
    <div className="cloud">
      {list.map((w) => (
        <button key={w.word} className="cloud-w" style={{ fontSize: size(w.count), fontWeight: w.count === max ? 700 : w.count > (max + min) / 2 ? 600 : 500, opacity: 0.55 + 0.45 * (w.count / max) }}
          onClick={() => onPick(w.word)} aria-label={`${w.word}: ${w.count}`}>
          {w.word}
        </button>
      ))}
    </div>
  );
}
