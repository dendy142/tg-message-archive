// Листы-формы вместо window.prompt: во вебвью Telegram он на части платформ не работает.
import { useEffect, useMemo, useState } from 'react';
import { call, ApiError } from '../api';
import { useNav } from '../nav';
import { haptic } from '../telegram';
import { Sheet } from './Sheet';
import { Cell, Segmented, SectionHeader, SectionFooter } from './ui';
import { Icon } from './Icon';
import { POPULAR_TZ, allTimezones, count, dayKey, deviceTimezone, fmtSmart, tzCity, tzOffsetLabel, W } from '../util';
import type { ChatView } from '../types';
import { Avatar } from './ui';
import { t, type Key } from '../i18n';

export function TimezoneSheet({ open, onClose, value, onPick }: { open: boolean; onClose: () => void; value: string; onPick: (tz: string, source: 'auto' | 'manual') => void }) {
  const [q, setQ] = useState('');
  useEffect(() => { if (open) setQ(''); }, [open]);
  const device = deviceTimezone();
  const all = useMemo(() => allTimezones(), []);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [...new Set([value, ...POPULAR_TZ])];
    const latin = s.replace(/\s+/g, '_');
    return all.filter((tz) => tz.toLowerCase().includes(latin) || tzCity(tz).toLowerCase().includes(s)).slice(0, 80);
  }, [q, all, value]);

  const row = (tz: string) => (
    <Cell key={tz} title={tzCity(tz)} sub={tz} value={tzOffsetLabel(tz)} onClick={() => onPick(tz, 'manual')}
      right={tz === value ? <Icon name="check" className="check" strokeWidth={2.4} /> : undefined} />
  );
  return (
    <Sheet open={open} onClose={onClose} title={t('sheets.tz.title')} message={t('sheets.tz.message')}>
      <label className="field">
        <Icon name="search" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('sheets.tz.search')} />
      </label>
      {!q && device && device !== value && (
        <>
          <div className="sec">
            <Cell icon="globe" color="var(--accent)" title={t('sheets.tz.device')} sub={`${device} · ${tzOffsetLabel(device)}`} onClick={() => onPick(device, 'auto')} />
          </div>
          <SectionHeader>{t('sheets.tz.popular')}</SectionHeader>
        </>
      )}
      <div className="sec">{list.length ? list.map(row) : <Cell title={t('sheets.tz.none')} sub={t('sheets.tz.noneHint')} />}</div>
    </Sheet>
  );
}

const FORMATS = [{ id: 'html', label: 'HTML' }, { id: 'json', label: 'JSON' }, { id: 'csv', label: 'CSV' }, { id: 'md', label: 'Markdown' }];
const KINDS: { id: string; label: Key }[] = [
  { id: 'all', label: 'sheets.export.kind.all' }, { id: 'deleted', label: 'sheets.export.kind.deleted' }, { id: 'edited', label: 'sheets.export.kind.edited' },
  { id: 'oneTime', label: 'sheets.export.kind.oneTime' }, { id: 'favorite', label: 'sheets.export.kind.favorite' },
];
const PERIODS: { id: string; label: Key }[] = [
  { id: 'all', label: 'sheets.export.per.all' }, { id: '30d', label: 'sheets.export.per.d30' }, { id: '7d', label: 'sheets.export.per.d7' },
  { id: 'today', label: 'common.today' }, { id: 'custom', label: 'sheets.export.per.custom' },
];
const FORMAT_HINT: Record<string, Key> = {
  html: 'sheets.export.hint.html', json: 'sheets.export.hint.json', csv: 'sheets.export.hint.csv', md: 'sheets.export.hint.md',
};

interface Estimate { rows: number; files: number; truncated: boolean }

export function ExportSheet({ open, onClose, chatId, chatName }: { open: boolean; onClose: () => void; chatId?: number; chatName?: string | null }) {
  const nav = useNav();
  const today = dayKey(Date.now());
  const [format, setFormat] = useState('html');
  const [kind, setKind] = useState('all');
  const [period, setPeriod] = useState('all');
  const [from, setFrom] = useState(dayKey(Date.now() - 29 * 86_400_000));
  const [to, setTo] = useState(today);
  const [est, setEst] = useState<Estimate | null>(null);
  const [busy, setBusy] = useState(false);

  const query = useMemo(() => ({
    format, kind, ...(period === 'custom' ? { from, to } : { period }), ...(chatId != null ? { chatId } : {}),
  }), [format, kind, period, from, to, chatId]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setEst(null);
    const t = setTimeout(() => {
      call<Estimate>('export', { ...query, estimate: true }).then((r) => { if (alive) setEst(r); }).catch(() => {});
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [open, query]);

  const run = async () => {
    setBusy(true);
    try {
      const r = await call<{ rows: number; files: number; truncated?: boolean }>('export', query);
      haptic('success');
      nav.toast(t('sheets.export.sent', { files: r.files > 1 ? t('sheets.export.filesN', { n: r.files }) : t('sheets.export.file'), count: count(r.rows, W.event) }), 'ok');
      onClose();
    } catch (e) {
      haptic('error');
      nav.toast((e as ApiError).message, 'err');
    } finally { setBusy(false); }
  };

  const badRange = period === 'custom' && (!from || !to || from > to);
  return (
    <Sheet open={open} onClose={onClose} title={chatId != null ? t('sheets.export.titleChat') : t('sheets.export.titleAll')}
      message={chatId != null ? chatName ?? undefined : t('sheets.export.message')}>
      <SectionHeader>{t('sheets.export.format')}</SectionHeader>
      <Segmented items={FORMATS} value={format} onChange={setFormat} />
      <SectionFooter>{FORMAT_HINT[format] ? t(FORMAT_HINT[format]) : ''}</SectionFooter>
      <SectionHeader>{t('sheets.export.what')}</SectionHeader>
      <div className="chips wrap">
        {KINDS.map((k) => <button key={k.id} className={`chip${kind === k.id ? ' on' : ''}`} onClick={() => setKind(k.id)}>{t(k.label)}</button>)}
      </div>
      <SectionHeader>{t('sheets.export.period')}</SectionHeader>
      <div className="chips wrap">
        {PERIODS.map((p) => <button key={p.id} className={`chip${period === p.id ? ' on' : ''}`} onClick={() => setPeriod(p.id)}>{t(p.label)}</button>)}
      </div>
      {period === 'custom' && (
        <div className="sec">
          <Cell title={t('sheets.from')} right={<input className="date-inline" type="date" value={from} max={to || today} onChange={(e) => setFrom(e.target.value)} />} />
          <Cell title={t('sheets.to')} right={<input className="date-inline" type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} />} />
        </div>
      )}
      <SectionFooter>
        {badRange ? t('sheets.export.badRange')
          : !est ? t('sheets.export.counting')
            : est.rows === 0 ? t('sheets.export.empty')
              : t('sheets.export.est', {
                count: count(est.rows, W.event),
                files: est.files > 1 ? t('sheets.export.estFiles', { n: est.files }) : '',
                trunc: est.truncated ? t('sheets.export.estTrunc') : '',
              })}
      </SectionFooter>
      <div className="pad" style={{ marginTop: 12 }}>
        <button className="btn" onClick={run} disabled={busy || badRange || est?.rows === 0}>
          {busy ? <span className="spin" style={{ borderTopColor: 'var(--accent-text)' }} /> : <Icon name="share" />}
          {busy ? t('sheets.export.busy') : t('sheets.export.send')}
        </button>
      </div>
    </Sheet>
  );
}

export function DateSheet({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (isoDay: string) => void }) {
  const today = dayKey(Date.now());
  const [val, setVal] = useState(today);
  useEffect(() => { if (open) setVal(today); }, [open, today]);
  const ago = (d: number) => dayKey(Date.now() - d * 86_400_000);
  const quick = [
    { label: t('common.today'), d: 0 }, { label: t('common.yesterday'), d: 1 }, { label: t('sheets.date.weekAgo'), d: 7 }, { label: t('sheets.date.monthAgo'), d: 30 },
  ];
  return (
    <Sheet open={open} onClose={onClose} title={t('sheets.date.title')}>
      <div className="sec">
        {quick.map((q) => <Cell key={q.d} title={q.label} onClick={() => onPick(ago(q.d))} chevron />)}
      </div>
      <SectionHeader>{t('sheets.date.other')}</SectionHeader>
      <div className="sec">
        <input className="date-input" type="date" value={val} max={today} onChange={(e) => setVal(e.target.value)} />
      </div>
      <div className="pad" style={{ marginTop: 16 }}>
        <button className="btn" disabled={!val} onClick={() => onPick(val)}><Icon name="calendar" />{t('sheets.show')}</button>
      </div>
    </Sheet>
  );
}

export function ChatPickerSheet({ open, onClose, value, onPick, allLabel }: {
  open: boolean; onClose: () => void; value: number | null; onPick: (c: { chatId: number; chatName: string | null } | null) => void; allLabel?: string;
}) {
  const [chats, setChats] = useState<ChatView[] | null>(null);
  const [q, setQ] = useState('');
  useEffect(() => {
    if (!open) return;
    setQ('');
    if (!chats) call<{ items: ChatView[] }>('chats', { limit: 200 }).then((r) => setChats(r.items)).catch(() => setChats([]));
  }, [open, chats]);
  const norm = (x: string) => x.toLowerCase().replace(/ё/g, 'е');
  const list = (chats ?? []).filter((c) => !q.trim() || norm(c.chatName ?? '').includes(norm(q.trim())));
  const check = <Icon name="check" className="check" strokeWidth={2.4} />;
  return (
    <Sheet open={open} onClose={onClose} title={t('sheets.chat.title')}>
      <label className="field">
        <Icon name="search" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('sheets.searchByName')} />
      </label>
      {!q && <div className="sec"><Cell icon="users" color="var(--accent)" title={allLabel ?? t('sheets.chat.all')} onClick={() => onPick(null)} right={value == null ? check : undefined} /></div>}
      <SectionHeader>{t('sheets.chat.chats')}</SectionHeader>
      <div className="sec">
        {chats == null ? <Cell title={t('common.loading')} />
          : !list.length ? <Cell title={t('sheets.nobody')} />
            : list.map((c) => (
              <Cell key={c.chatId} className="av" left={<Avatar id={c.chatId} name={c.chatName} size={36} />} title={c.chatName ?? t('sheets.chatFallback', { id: c.chatId })}
                sub={`${count(c.total, W.msg)} · ${fmtSmart(c.lastAt)}`} onClick={() => onPick({ chatId: c.chatId, chatName: c.chatName })}
                right={value === c.chatId ? check : undefined} />
            ))}
      </div>
    </Sheet>
  );
}

export function RangeSheet({ open, onClose, value, onPick }: {
  open: boolean; onClose: () => void; value: { from: string; to: string } | null; onPick: (r: { from: string; to: string }) => void;
}) {
  const today = dayKey(Date.now());
  const [from, setFrom] = useState(value?.from ?? dayKey(Date.now() - 29 * 86_400_000));
  const [to, setTo] = useState(value?.to ?? today);
  useEffect(() => { if (open) { setFrom(value?.from ?? dayKey(Date.now() - 29 * 86_400_000)); setTo(value?.to ?? today); } }, [open, value, today]);
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
  const bad = !from || !to || days < 1;
  return (
    <Sheet open={open} onClose={onClose} title={t('sheets.range.title')} message={t('sheets.range.message')}>
      <div className="sec">
        <Cell title={t('sheets.from')} right={<input className="date-inline" type="date" value={from} max={to || today} onChange={(e) => setFrom(e.target.value)} />} />
        <Cell title={t('sheets.to')} right={<input className="date-inline" type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} />} />
      </div>
      {!bad && <SectionFooter>{t(days > 366 ? 'sheets.range.daysCapped' : 'sheets.range.days', { count: count(Math.min(days, 366), W.day) })}</SectionFooter>}
      <div className="pad" style={{ marginTop: 16 }}>
        <button className="btn" disabled={bad} onClick={() => onPick({ from, to })}><Icon name="calendar" />{t('sheets.show')}</button>
      </div>
    </Sheet>
  );
}
