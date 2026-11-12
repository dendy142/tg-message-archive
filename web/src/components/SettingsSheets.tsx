import { useEffect, useState } from 'react';
import { call, ApiError } from '../api';
import { useNav } from '../nav';
import { haptic } from '../telegram';
import type { ChatView, MirrorGroup, NotifyType, OperatorView, SettingsView } from '../types';
import { Sheet } from './Sheet';
import { Cell, ToggleCell, Switch, Segmented, SectionHeader, SectionFooter, Avatar } from './ui';
import { Icon, type IconName } from './Icon';
import { PinPad } from './PinPad';
import { count, W } from '../util';
import { t, type Key } from '../i18n';

type Save = (patch: Partial<SettingsView>) => Promise<boolean>;

export const NOTIFY_ITEMS: { id: NotifyType; label: Key; hint: Key; icon: IconName; color: string }[] = [
  { id: 'deleted', label: 'sheets.notify.deleted', hint: 'sheets.notify.deletedHint', icon: 'trash', color: 'var(--red)' },
  { id: 'deletedUnknown', label: 'sheets.notify.deletedUnknown', hint: 'sheets.notify.deletedUnknownHint', icon: 'trash', color: '#8e8e93' },
  { id: 'edited', label: 'sheets.notify.edited', hint: 'sheets.notify.editedHint', icon: 'pencil', color: 'var(--orange)' },
  { id: 'wipe', label: 'sheets.notify.wipe', hint: 'sheets.notify.wipeHint', icon: 'archive', color: '#5856d6' },
  { id: 'oneTime', label: 'sheets.notify.oneTime', hint: 'sheets.notify.oneTimeHint', icon: 'flame', color: 'var(--fire)' },
  { id: 'keywords', label: 'sheets.notify.keywords', hint: 'sheets.notify.keywordsHint', icon: 'tag', color: '#34c759' },
  { id: 'rename', label: 'sheets.notify.rename', hint: 'sheets.notify.renameHint', icon: 'user', color: '#007aff' },
];

export function NotifyTypesSheet({ open, onClose, s, save }: { open: boolean; onClose: () => void; s: SettingsView; save: Save }) {
  return (
    <Sheet open={open} onClose={onClose} title={t('sheets.notify.title')} message={t('sheets.notify.message')}>
      <div className="sec">
        {NOTIFY_ITEMS.map((n) => (
          <ToggleCell key={n.id} icon={n.icon} color={n.color} title={t(n.label)} sub={t(n.hint)} on={s.notifyTypes[n.id]}
            onChange={(v) => save({ notifyTypes: { ...s.notifyTypes, [n.id]: v } })} />
        ))}
      </div>
    </Sheet>
  );
}

export function QuietHoursSheet({ open, onClose, s, save }: { open: boolean; onClose: () => void; s: SettingsView; save: Save }) {
  const [on, setOn] = useState(!!s.quietHours);
  const [from, setFrom] = useState(s.quietHours?.from ?? '23:00');
  const [to, setTo] = useState(s.quietHours?.to ?? '08:00');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setOn(!!s.quietHours); setFrom(s.quietHours?.from ?? '23:00'); setTo(s.quietHours?.to ?? '08:00');
  }, [open, s.quietHours]);
  const bad = on && (!from || !to || from === to);
  const apply = async () => {
    setBusy(true);
    try { if (await save({ quietHours: on ? { from, to } : null })) onClose(); } finally { setBusy(false); }
  };
  return (
    <Sheet open={open} onClose={onClose} title={t('sheets.quiet.title')} message={t('sheets.quiet.message')}>
      <div className="sec">
        <ToggleCell icon="moon" color="#5856d6" title={t('sheets.quiet.title')} on={on} onChange={setOn} />
        {on && <>
          <Cell title={t('sheets.from')} right={<input className="date-inline" type="time" value={from} onChange={(e) => setFrom(e.target.value)} />} />
          <Cell title={t('sheets.until')} right={<input className="date-inline" type="time" value={to} onChange={(e) => setTo(e.target.value)} />} />
        </>}
      </div>
      {on && <SectionFooter>{t(from > to ? 'sheets.quiet.footerOvernight' : 'sheets.quiet.footer', { from, to })}</SectionFooter>}
      <div className="pad" style={{ marginTop: 16 }}>
        <button className="btn" disabled={busy || bad} onClick={apply}>{busy ? t('sheets.saving') : t('sheets.save')}</button>
      </div>
    </Sheet>
  );
}

const splitWords = (s: string) => s.split(/[,\n]/).map((w) => w.trim().toLowerCase()).filter(Boolean);

function WordList({ list, onChange, placeholder }: { list: string[]; onChange: (l: string[]) => void; placeholder: string }) {
  const [input, setInput] = useState('');
  const add = () => {
    const words = splitWords(input);
    if (!words.length) return;
    onChange([...list, ...words.filter((w) => !list.includes(w))].slice(0, 50));
    setInput('');
    haptic('select');
  };
  return (
    <div className="sec">
      <div className="field-row">
        <input className="input-cell" value={input} onChange={(e) => setInput(e.target.value)} placeholder={placeholder}
          enterKeyHint="done" maxLength={64} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} onBlur={add} />
        <button className="add-btn" onClick={add} disabled={!input.trim()} aria-label={t('sheets.kw.add')}><Icon name="plus" strokeWidth={2.4} /></button>
      </div>
      {list.length > 0 && (
        <div className="kw-list">
          {list.map((w) => (
            <span key={w} className="kw">{w}<button onClick={() => onChange(list.filter((x) => x !== w))} aria-label={t('sheets.kw.remove', { word: w })}><Icon name="close" strokeWidth={2.4} /></button></span>
          ))}
        </div>
      )}
    </div>
  );
}

export function KeywordsSheet({ open, onClose, s, save }: { open: boolean; onClose: () => void; s: SettingsView; save: Save }) {
  const [words, setWords] = useState(s.keywords);
  const [exclude, setExclude] = useState(s.keywordExclude);
  const [whole, setWhole] = useState(s.keywordWholeWord);
  const [loud, setLoud] = useState(s.keywordLoud);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setWords(s.keywords); setExclude(s.keywordExclude); setWhole(s.keywordWholeWord); setLoud(s.keywordLoud);
  }, [open, s.keywords, s.keywordExclude, s.keywordWholeWord, s.keywordLoud]);
  const apply = async () => {
    setBusy(true);
    try {
      if (await save({ keywords: words, keywordExclude: exclude, keywordWholeWord: whole, keywordLoud: loud })) onClose();
    } finally { setBusy(false); }
  };
  return (
    <Sheet open={open} onClose={onClose} title={t('sheets.kw.title')} message={t('sheets.kw.message')}>
      <WordList list={words} onChange={setWords} placeholder={t('sheets.kw.placeholder')} />
      <SectionFooter>{t('sheets.kw.footer', { hint: words.length ? `${count(words.length, W.word)}.` : t('sheets.kw.example') })}</SectionFooter>

      <SectionHeader>{t('sheets.kw.how')}</SectionHeader>
      <Segmented items={[{ id: 'part', label: t('sheets.kw.part') }, { id: 'whole', label: t('sheets.kw.whole') }]} value={whole ? 'whole' : 'part'} onChange={(v) => setWhole(v === 'whole')} />
      <SectionFooter>{whole ? t('sheets.kw.wholeHint') : t('sheets.kw.partHint')}</SectionFooter>

      <SectionHeader>{t('sheets.kw.exceptions')}</SectionHeader>
      <WordList list={exclude} onChange={setExclude} placeholder={t('sheets.kw.excludePlaceholder')} />
      <SectionFooter>{t('sheets.kw.exceptionsHint')}</SectionFooter>

      <div className="sec" style={{ marginTop: 16 }}>
        <ToggleCell icon="bell" color="#ff9500" title={t('sheets.kw.loud')} on={loud} onChange={setLoud} />
      </div>
      <div className="pad" style={{ marginTop: 16 }}>
        <button className="btn" disabled={busy} onClick={apply}>{busy ? t('sheets.saving') : t('sheets.save')}</button>
      </div>
    </Sheet>
  );
}

export const MIRROR_ITEMS: { id: MirrorGroup; label: Key; hint: Key; icon: IconName; color: string }[] = [
  { id: 'photo', label: 'sheets.mirror.photo', hint: 'sheets.mirror.photoHint', icon: 'image', color: '#34aadc' },
  { id: 'video', label: 'sheets.mirror.video', hint: 'sheets.mirror.videoHint', icon: 'video', color: '#af52de' },
  { id: 'voice', label: 'sheets.mirror.voice', hint: 'sheets.mirror.voiceHint', icon: 'mic', color: '#ff9500' },
  { id: 'document', label: 'sheets.mirror.document', hint: 'sheets.mirror.documentHint', icon: 'file', color: '#007aff' },
];
const LIMITS: { id: string; mb: number | null }[] = [
  { id: 'none', mb: null }, { id: '20', mb: 20 }, { id: '50', mb: 50 }, { id: '100', mb: 100 },
];
const limitLabel = (mb: number | null) => (mb == null ? t('sheets.mirror.noLimit') : t('unit.mb', { n: mb }));

export function MirrorSheet({ open, onClose, s, save }: { open: boolean; onClose: () => void; s: SettingsView; save: Save }) {
  const toggle = (g: MirrorGroup, v: boolean) => {
    const next = v ? [...new Set([...s.mirrorTypes, g])] : s.mirrorTypes.filter((x) => x !== g);
    save({ mirrorTypes: next });
  };
  return (
    <Sheet open={open} onClose={onClose} title={t('sheets.mirror.title')} message={t('sheets.mirror.message')}>
      <div className="sec">
        {MIRROR_ITEMS.map((m) => (
          <ToggleCell key={m.id} icon={m.icon} color={m.color} title={t(m.label)} sub={t(m.hint)} on={s.mirrorTypes.includes(m.id)} onChange={(v) => toggle(m.id, v)} />
        ))}
      </div>
      <SectionHeader>{t('sheets.mirror.limit')}</SectionHeader>
      <Segmented items={LIMITS.map((l) => ({ id: l.id, label: limitLabel(l.mb) }))} value={s.mirrorMaxMb == null ? 'none' : String(s.mirrorMaxMb)}
        onChange={(id) => save({ mirrorMaxMb: LIMITS.find((l) => l.id === id)!.mb })} />
      <SectionFooter>{t('sheets.mirror.footer')}</SectionFooter>
    </Sheet>
  );
}

export function ExcludedSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nav = useNav();
  const [chats, setChats] = useState<ChatView[] | null>(null);
  const [q, setQ] = useState('');
  useEffect(() => {
    if (!open) return;
    setQ('');
    call<{ items: ChatView[] }>('chats', { limit: 200 }).then((r) => setChats(r.items)).catch(() => setChats([]));
  }, [open]);

  const setExcluded = async (c: ChatView, v: boolean) => {
    setChats((list) => list?.map((x) => (x.chatId === c.chatId ? { ...x, excluded: v } : x)) ?? null);
    haptic('select');
    try {
      await call('action', { type: 'exclude', chatId: c.chatId, value: v });
      nav.reloadBoot().catch(() => {});
    } catch (e) {
      setChats((list) => list?.map((x) => (x.chatId === c.chatId ? { ...x, excluded: !v } : x)) ?? null);
      nav.toast((e as ApiError).message, 'err');
    }
  };

  const norm = (x: string) => x.toLowerCase().replace(/ё/g, 'е');
  const list = (chats ?? []).filter((c) => !q.trim() || norm(c.chatName ?? '').includes(norm(q.trim())))
    .sort((a, b) => Number(!!b.excluded) - Number(!!a.excluded));
  return (
    <Sheet open={open} onClose={onClose} title={t('sheets.excluded.title')} message={t('sheets.excluded.message')}>
      {(chats?.length ?? 0) > 6 && (
        <label className="field">
          <Icon name="search" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('sheets.searchByName')} />
        </label>
      )}
      <div className="sec">
        {chats == null ? <Cell title={t('common.loading')} />
          : !list.length ? <Cell title={chats.length ? t('sheets.nobody') : t('sheets.excluded.noChats')} />
            : list.map((c) => (
              <Cell key={c.chatId} className="av" left={<Avatar id={c.chatId} name={c.chatName} size={36} />} title={c.chatName ?? t('sheets.chatFallback', { id: c.chatId })}
                sub={c.excluded ? t('sheets.excluded.notSaved') : count(c.total, W.msg)} onClick={() => setExcluded(c, !c.excluded)}
                checked={!!c.excluded} label={t('sheets.excluded.label', { name: c.chatName ?? c.chatId })} right={<Switch on={!!c.excluded} />} />
            ))}
      </div>
      <SectionFooter>{t('sheets.excluded.footer')}</SectionFooter>
    </Sheet>
  );
}

type PinStep = 'current' | 'new' | 'repeat';

export function PinSheet({ open, onClose, hasPin, purpose, clearTo, onDone }: {
  open: boolean; onClose: () => void; hasPin: boolean; purpose: 'set' | 'clear'; clearTo?: 'off' | 'biometric';
  onDone: (s: SettingsView) => void;
}) {
  const nav = useNav();
  const [step, setStep] = useState<PinStep>('new');
  const [current, setCurrent] = useState('');
  const [first, setFirst] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!open) return;
    setStep(hasPin ? 'current' : 'new'); setCurrent(''); setFirst(''); setError(null); setN((x) => x + 1);
  }, [open, hasPin]);

  const fail = (msg: string) => { setError(msg); haptic('error'); setN((x) => x + 1); };
  const submit = async (pin: string) => {
    if (step === 'current') {
      if (purpose === 'clear') {
        setBusy(true);
        try {
          const r = await call<{ settings: SettingsView }>('pin', { clear: true, pin, mode: clearTo ?? 'biometric' });
          haptic('success'); nav.toast(t('sheets.pin.removed'), 'ok'); onDone(r.settings); onClose();
        } catch (e) { fail((e as ApiError).message); }
        finally { setBusy(false); }
        return;
      }
      setCurrent(pin); setStep('new'); setError(null); setN((x) => x + 1); return;
    }
    if (step === 'new') { setFirst(pin); setStep('repeat'); setError(null); setN((x) => x + 1); return; }
    if (pin !== first) { setStep('new'); setFirst(''); fail(t('sheets.pin.mismatch')); return; }
    setBusy(true);
    try {
      const r = await call<{ settings: SettingsView }>('pin', { set: true, pin, ...(hasPin ? { current } : {}) });
      haptic('success'); nav.toast(t('sheets.pin.set'), 'ok'); onDone(r.settings); onClose();
    } catch (e) {
      const code = (e as ApiError).code;
      if (code === 'WRONG_PIN') { setStep('current'); setCurrent(''); }
      fail((e as ApiError).message);
    } finally { setBusy(false); }
  };
  const title = step === 'current' ? t('sheets.pin.current') : step === 'new' ? (hasPin ? t('sheets.pin.new') : t('sheets.pin.create')) : t('sheets.pin.repeat');
  return (
    <Sheet open={open} onClose={onClose} title={title}
      message={step === 'new' ? t('sheets.pin.message') : undefined}>
      <div className="pad" style={{ display: 'flex', justifyContent: 'center' }}>
        <PinPad onSubmit={submit} busy={busy} error={error} resetKey={`${step}:${n}`} />
      </div>
    </Sheet>
  );
}

export function OperatorSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [data, setData] = useState<OperatorView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  useEffect(() => {
    if (!open) return;
    setError(null); setExpanded(null);
    call<OperatorView>('operator').then(setData).catch((e) => setError((e as ApiError).message));
  }, [open]);
  const s = data?.stats;
  const rows: [string, string | number][] = s ? [
    [t('sheets.op.owners'), s.owners], [t('sheets.op.connections'), s.activeConnections],
    [t('sheets.op.pendingMirror'), s.pendingMirror], [t('sheets.op.failedMirror'), s.failedMirror],
    [t('sheets.op.outbox'), s.outboxDepth], [t('sheets.op.jobs'), s.activeJobs],
    [t('sheets.op.errors24h'), s.errors24h], [t('sheets.op.messageRows'), s.messageRows],
    [t('sheets.op.version'), `${s.version.version} (${s.version.commit})`],
  ] : [];
  return (
    <Sheet open={open} onClose={onClose} title={t('sheets.op.title')}>
      <div className="sec">
        {error ? <Cell title={error} /> : !s ? <Cell title={t('common.loading')} /> : rows.map(([k, v]) => <Cell key={k} title={k} value={String(v)} />)}
      </div>
      {data && (
        <>
          <SectionHeader>{t('sheets.op.recent')}</SectionHeader>
          <div className="sec">
            {!data.errors.length ? <Cell title={t('sheets.op.noErrors')} />
              : data.errors.map((e) => (
                <Cell key={e.id} title={e.where} onClick={() => setExpanded(expanded === e.id ? null : e.id)}
                  sub={<>
                    {new Date(e.at).toLocaleString()}{e.ownerUserId ? ` · ${e.ownerUserId}` : ''} · {expanded === e.id ? e.message : (e.message ?? '').slice(0, 120)}
                    {expanded === e.id && e.stack && <pre className="op-stack">{e.stack}</pre>}
                  </>} />
              ))}
          </div>
          <SectionFooter>{t('sheets.op.footer')}</SectionFooter>
        </>
      )}
    </Sheet>
  );
}
