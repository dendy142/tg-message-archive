import { useMemo, useState } from 'react';
import type { DayStat } from '../types';
import { dayKey, fmtLongDate, fmtNum, fmtShortDate } from '../util';
import { t, type Key } from '../i18n';

// Порядок рядов проверен на различимость при дальтонизме (соседние пары красный↔синий↔оранжевый).
const SERIES = [
  { key: 'deleted', label: 'charts.activity.deleted', color: 'var(--red)' },
  { key: 'captured', label: 'charts.activity.captured', color: 'var(--blue)' },
  { key: 'edited', label: 'charts.activity.edited', color: 'var(--orange)' },
] as const satisfies readonly { key: string; label: Key; color: string }[];

interface Bucket extends DayStat { to: string; total: number }

function niceMax(v: number): number {
  if (v <= 4) return 4;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.2, 1.6, 2, 3, 4, 5, 6, 8, 10]) if (m * p >= v && Number.isInteger((m * p) / 2)) return m * p;
  return 10 * p;
}

function bucketize(days: DayStat[], size: number): Bucket[] {
  const out: Bucket[] = [];
  for (let i = 0; i < days.length; i += size) {
    const part = days.slice(i, i + size);
    const b = { date: part[0].date, to: part[part.length - 1].date, captured: 0, deleted: 0, edited: 0, total: 0 };
    for (const d of part) { b.captured += d.captured; b.deleted += d.deleted; b.edited += d.edited; }
    b.total = b.captured + b.deleted + b.edited;
    out.push(b);
  }
  return out;
}

function peaks(days: DayStat[]): number[] {
  const xs = days.map((d) => d.deleted);
  const mean = xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length || 1));
  return xs.map((x, i) => (x >= 5 && x > mean + 2 * sd ? i : -1)).filter((i) => i >= 0);
}

export function ActivityChart({ data, prev, compact }: { data: DayStat[]; prev?: DayStat[]; compact?: boolean }) {
  const size = data.length > 92 ? 7 : 1;
  const buckets = useMemo(() => bucketize(data, size), [data, size]);
  const prevBuckets = useMemo(() => (prev?.length === data.length ? bucketize(prev, size) : null), [prev, data.length, size]);
  const peakIdx = useMemo(() => (size === 1 && !compact ? peaks(data) : []), [data, size, compact]);
  const [sel, setSel] = useState<number | null>(null);
  const cur = sel != null ? buckets[sel] : null;

  const totals = useMemo(() => buckets.reduce((s, b) => ({ deleted: s.deleted + b.deleted, captured: s.captured + b.captured, edited: s.edited + b.edited }), { deleted: 0, captured: 0, edited: 0 }), [buckets]);
  const max = niceMax(Math.max(1, ...buckets.map((b) => b.total), ...(prevBuckets ?? []).map((b) => b.total)));
  const shown = cur ?? totals;
  const n = buckets.length;
  const gap = n > 45 ? 0.5 : n > 14 ? 1.5 : 4;
  const label = (b: Bucket) => (size === 1 ? fmtLongDate(b.date) : `${fmtShortDate(b.date)} — ${fmtShortDate(b.to)}`);
  const line = prevBuckets?.map((b, i) => `${i + 0.5},${max - b.total}`).join(' ');

  return (
    <div className={`chart${cur ? ' has-sel' : ''}${compact ? ' compact' : ''}`}>
      <div className="c-head">
        <div>
          <div className="c-day">{cur ? label(cur) : size === 7 ? t('charts.activity.byWeeks', { n: data.length }) : t('charts.activity.total', { n: data.length })}</div>
          <div className="c-vals">
            {SERIES.map((s) => (
              <span key={s.key}><i className="sw" style={{ background: s.color }} />{t(s.label)} <b className="tnum">{fmtNum(shown[s.key])}</b></span>
            ))}
            {prevBuckets && (
              <span><i className="sw-line" />{cur ? t('charts.activity.before') : t('charts.activity.prevPeriod')} <b className="tnum">{fmtNum(cur ? prevBuckets[sel!].total : prevBuckets.reduce((a, b) => a + b.total, 0))}</b></span>
            )}
          </div>
        </div>
      </div>
      <div className="plot">
        {[0, 0.5, 1].map((f) => (
          <div key={f} className={`grid-l${f === 0 ? ' base' : ''}`} style={{ bottom: `${f * 100}%` }}>
            {f > 0 && <span className="tnum">{fmtNum(Math.round(max * f))}</span>}
          </div>
        ))}
        <div className="cols" style={{ ['--cg' as string]: `${gap}px` }}>
          {buckets.map((b, i) => (
            <button key={b.date} className={`col${sel === i ? ' sel' : ''}`} onClick={() => setSel(sel === i ? null : i)}
              aria-label={t('charts.activity.colAria', { label: label(b), deleted: b.deleted, captured: b.captured, edited: b.edited })}>
              {b.total > 0 && (
                <span className="bar" style={{ height: `${(b.total / max) * 100}%` }}>
                  {SERIES.map((s) => b[s.key] > 0 && <i key={s.key} style={{ height: `${(b[s.key] / b.total) * 100}%`, background: s.color }} />)}
                </span>
              )}
            </button>
          ))}
        </div>
        {line && (
          <svg className="prev-line" viewBox={`0 0 ${n} ${max}`} preserveAspectRatio="none" aria-hidden="true">
            <polyline points={line} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
          </svg>
        )}
      </div>
      <div className="x">
        <span>{fmtShortDate(buckets[0].date)}</span>
        {n > 2 && <span>{fmtShortDate(buckets[Math.floor(n / 2)].date)}</span>}
        <span>{buckets[n - 1].to === dayKey(Date.now()) ? t('common.todayLower') : fmtShortDate(buckets[n - 1].to)}</span>
      </div>
      {peakIdx.length > 0 && (
        <div className="peaks">
          <span className="hint">{t('charts.activity.peaks')}</span>
          {peakIdx.slice(-4).map((i) => (
            <button key={i} className={`peak${sel === i ? ' on' : ''}`} onClick={() => setSel(sel === i ? null : i)}>
              {fmtShortDate(data[i].date)} · <b className="tnum">{data[i].deleted}</b>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
