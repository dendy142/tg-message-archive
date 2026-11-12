import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { call, ApiError } from '../api';
import { useNav, useLayerActive } from '../nav';
import { emit, useBus } from '../bus';
import { confirm, haptic, copyText } from '../telegram';
import { Composer } from '../components/Composer';
import type { EventView, Cursor } from '../types';
import { Header, IconButton, Chips, Empty, ErrorState, SkeletonBubbles, Spinner, useSentinel } from '../components/ui';
import { Icon, mediaColor, mediaIconName } from '../components/Icon';
import { Diff } from '../components/Diff';
import { ThumbImg, AudioPlayer, GifVideo, StickerView, aspectOf, durationOf, isAudio, isPhoto, isVideo, mediaName } from '../components/Media';
import { MediaViewer, viewable } from '../components/Viewer';
import { ExportSheet, DateSheet } from '../components/Sheets';
import { deleteChatFlow, chatDeleteInfo, type ChatDeleteInfo } from '../deleteChat';
import { t, type Key } from '../i18n';
import { count, dayKey, fmtDay, fmtDuration, fmtSize, fmtTime, W } from '../util';

interface Resp {
  chatId: number; chatName: string | null; muted: boolean; autoRead: boolean; items: EventView[]; hasOlder: boolean; hasNewer: boolean;
  replyWindowOpen?: boolean; replyWindowUntil?: number | null;
}
type ScrollTarget = 'bottom' | 'top' | { id: number } | { anchor: number; height: number } | null;

const PAGE = 50;
type Filter = 'all' | 'deleted' | 'edited' | 'media' | 'favorite';
const FILTERS: { id: Filter; label: Key }[] = [
  { id: 'all', label: 'conversation.filter.all' }, { id: 'deleted', label: 'conversation.filter.deleted' }, { id: 'edited', label: 'conversation.filter.edited' },
  { id: 'media', label: 'conversation.filter.media' }, { id: 'favorite', label: 'conversation.filter.favorite' },
];
const FILTER_EMPTY: Record<Filter, Key> = {
  all: 'conversation.empty.all', deleted: 'conversation.empty.deleted', edited: 'conversation.empty.edited',
  media: 'conversation.empty.media', favorite: 'conversation.empty.favorite',
};
const docH = () => document.documentElement.scrollHeight;

export function Conversation({ chatId, chatName, jumpTo, focusId, compose }: { chatId: number; chatName?: string | null; jumpTo?: string; focusId?: number; compose?: boolean }) {
  const nav = useNav();
  const active = useLayerActive();
  const [items, setItems] = useState<EventView[]>([]);
  const [name, setName] = useState<string | null>(chatName ?? null);
  const [muted, setMuted] = useState(false);
  const [hasOlder, setHasOlder] = useState(false);
  const [hasNewer, setHasNewer] = useState(false);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [err, setErr] = useState<string | null>(null);
  const [edge, setEdge] = useState<null | 'older' | 'newer'>(null);
  const [view, setView] = useState<EventView | null>(null);
  const [sheet, setSheet] = useState<null | 'date' | 'export'>(null);
  const [flash, setFlash] = useState<number | null>(null);
  const [nearBottom, setNearBottom] = useState(true);
  const [replyTo, setReplyTo] = useState<EventView | null>(null);
  const [win, setWin] = useState<{ open: boolean; until: number | null }>({ open: true, until: null });
  const [filter, setFilter] = useState<Filter>('all');
  const canReply = nav.boot.connection.canReply;
  const busy = useRef(false);
  const gen = useRef(0);
  const target = useRef<ScrollTarget>(null);
  const composerFocus = useRef(!!compose);

  const { toast } = nav;
  const fetchPage = useCallback((opts: Record<string, unknown>) => call<Resp>('chatHistory', { chatId, limit: PAGE, filter, ...opts }), [chatId, filter]);
  const applyMeta = (r: Resp) => {
    setName((n) => r.chatName ?? n); setMuted(r.muted);
    if (r.replyWindowOpen !== undefined) setWin({ open: r.replyWindowOpen, until: r.replyWindowUntil ?? null });
  };

  const loadMain = useCallback(async (day?: string, focus?: number) => {
    const my = ++gen.current;
    busy.current = true;
    setState((s) => (s === 'ready' ? s : 'loading'));
    try {
      let jump: Cursor | null = null;
      if (day) {
        const j = await call<{ jump: Cursor | null }>('chatHistory', { chatId, jumpTo: day, filter });
        if (!j.jump) toast(t('conversation.noMessagesThatDay'));
        jump = j.jump;
      }
      const r = await fetchPage(jump ? { after: jump } : {});
      if (my !== gen.current) return;
      applyMeta(r);
      target.current = focus ? { id: focus } : jump ? 'top' : 'bottom';
      setItems(r.items);
      setHasOlder(r.hasOlder);
      setHasNewer(jump ? r.hasNewer : false);
      setState('ready');
      if (focus) setFlash(focus);
    } catch (e) {
      if (my !== gen.current) return;
      setErr((e as ApiError).message); setState('error');
    } finally {
      if (my === gen.current) busy.current = false;
    }
  }, [chatId, fetchPage, toast, filter]);

  useEffect(() => { loadMain(jumpTo, focusId); }, [loadMain, jumpTo, focusId]);

  const loadOlder = useCallback(async () => {
    const first = items[0];
    if (busy.current || !first?.date) return;
    busy.current = true; setEdge('older');
    const my = gen.current;
    try {
      const r = await fetchPage({ before: { k: first.date, id: first.id } });
      if (my !== gen.current) return;
      target.current = { anchor: window.scrollY, height: docH() };
      setItems((p) => [...r.items.filter((x) => !p.some((y) => y.id === x.id)), ...p]);
      setHasOlder(r.hasOlder);
    } catch { /* повторится при следующей прокрутке */ }
    finally { if (my === gen.current) { busy.current = false; setEdge(null); } }
  }, [items, fetchPage]);

  const loadNewer = useCallback(async () => {
    const last = items[items.length - 1];
    if (busy.current || !last?.date) return;
    busy.current = true; setEdge('newer');
    const my = gen.current;
    try {
      const r = await fetchPage({ after: { k: last.date, id: last.id } });
      if (my !== gen.current) return;
      setItems((p) => [...p, ...r.items.filter((x) => !p.some((y) => y.id === x.id))]);
      setHasNewer(r.hasNewer);
    } catch { /* повторится */ }
    finally { if (my === gen.current) { busy.current = false; setEdge(null); } }
  }, [items, fetchPage]);

  useLayoutEffect(() => {
    const t = target.current;
    if (!t) return;
    target.current = null;
    if (t === 'bottom') window.scrollTo(0, docH());
    else if (t === 'top') window.scrollTo(0, 0);
    else if ('id' in t) document.getElementById(`m${t.id}`)?.scrollIntoView({ block: 'center' });
    else window.scrollTo(0, t.anchor + (docH() - t.height));
  }, [items]);

  useEffect(() => {
    if (flash == null) return;
    const t = setTimeout(() => setFlash(null), 2200);
    return () => clearTimeout(t);
  }, [flash]);

  useEffect(() => {
    if (!active) return;
    const upd = () => setNearBottom(window.innerHeight + window.scrollY >= docH() - 240);
    upd();
    window.addEventListener('scroll', upd, { passive: true });
    return () => window.removeEventListener('scroll', upd);
  }, [active, items]);

  const topSentinel = useSentinel(loadOlder, state === 'ready' && hasOlder && !edge);
  const bottomSentinel = useSentinel(loadNewer, state === 'ready' && hasNewer && !edge);

  useBus((ev) => {
    if (ev.type === 'eventDeleted') setItems((p) => p.filter((e) => e.id !== ev.id));
    if (ev.type === 'favorite') setItems((p) => p.map((e) => (e.id === ev.id ? { ...e, isFavorite: ev.value } : e)));
    if (ev.type === 'muted' && ev.chatId === chatId) setMuted(ev.value);
  });

  const toggleMute = async () => {
    try {
      const r = await call<{ muted: boolean }>('action', { type: 'mute', chatId });
      setMuted(r.muted); emit({ type: 'muted', chatId, value: r.muted }); haptic('select');
      nav.toast(t(r.muted ? 'conversation.muteOn' : 'conversation.muteOff'));
    } catch (e) { nav.toast((e as ApiError).message, 'err'); }
  };

  const deleteHistory = async () => {
    let info: ChatDeleteInfo;
    try { info = await chatDeleteInfo(chatId); }
    catch (e) { nav.toast((e as ApiError).message, 'err'); return; }
    const c = info.counts;
    const period = await nav.choose({
      title: t('conversation.deleteHistory.title'),
      message: t('conversation.deleteHistory.message'),
      options: [
        { value: 'today', label: t('conversation.deleteHistory.today'), hint: c.today ? count(c.today, W.msg) : t('conversation.deleteHistory.none'), icon: 'clock', tone: 'danger' },
        { value: '3d', label: t('conversation.deleteHistory.last3d'), hint: c.last3d ? count(c.last3d, W.msg) : t('conversation.deleteHistory.none'), icon: 'calendar', tone: 'danger' },
        { value: 'all', label: t('conversation.deleteHistory.all'), hint: count(c.all, W.msg), icon: 'trash', tone: 'danger' },
      ],
    });
    if (!period) return;
    if (period === 'all') { await deleteChatFlow(nav, chatId, name, info); return; }
    try {
      const r = await call<{ removed: number }>('action', { type: 'deleteChatHistory', chatId, period });
      haptic('warning');
      emit({ type: 'historyDeleted', chatId });
      nav.toast(t('conversation.deleteHistory.done', { msgs: count(r.removed, W.msg) }));
      loadMain();
    } catch (e) { nav.toast((e as ApiError).message, 'err'); }
  };

  const sendAllFiles = async () => {
    if (!(await confirm(t('conversation.sendFiles.confirm')))) return;
    try {
      const r = await call<{ job: { total: number } }>('action', { type: 'exportMedia', chatId });
      haptic('success');
      nav.toast(t('conversation.sendFiles.toast', { files: count(r.job.total, W.file) }), 'ok');
      nav.reloadBoot().catch(() => {});
    } catch (e) { nav.toast((e as ApiError).message, 'err'); }
  };

  const menu = async () => {
    const v = await nav.choose({
      options: [
        { value: 'profile', label: t('conversation.menu.profile'), icon: 'user' },
        { value: 'search', label: t('conversation.menu.search'), icon: 'search' },
        { value: 'media', label: t('conversation.menu.media'), icon: 'image' },
        { value: 'date', label: t('conversation.menu.date'), icon: 'calendar' },
        { value: 'mute', label: t(muted ? 'conversation.menu.unmute' : 'conversation.menu.mute'), icon: muted ? 'bell' : 'bellOff' },
        { value: 'export', label: t('conversation.menu.export'), icon: 'share' },
        { value: 'files', label: t('conversation.menu.sendFiles'), icon: 'download' },
        { value: 'delete', label: t('conversation.deleteHistory.title'), icon: 'trash', tone: 'danger' },
      ],
    });
    if (v === 'profile') nav.push({ name: 'contact', chatId });
    if (v === 'search') nav.push({ name: 'search', chatId, chatName: name });
    if (v === 'media') nav.push({ name: 'media', chatId, chatName: name });
    if (v === 'date') setSheet('date');
    if (v === 'mute') toggleMute();
    if (v === 'export') setSheet('export');
    if (v === 'files') sendAllFiles();
    if (v === 'delete') deleteHistory();
  };

  const bubbleMenu = async (e: EventView) => {
    const v = await nav.choose({
      options: [
        ...(canReply && win.open ? [{ value: 'reply', label: t('conversation.bubble.reply'), icon: 'reply' as const }] : []),
        ...(e.text || e.caption ? [{ value: 'copy', label: t('conversation.bubble.copy'), icon: 'copy' as const }] : []),
        { value: 'open', label: t('conversation.bubble.details'), icon: 'info' },
      ],
    });
    if (v === 'reply') setReplyTo(e);
    if (v === 'copy' && (await copyText(e.text ?? e.caption ?? ''))) nav.toast(t('conversation.copied'), 'ok');
    if (v === 'open') nav.push({ name: 'event', id: e.id });
  };

  const days = useMemo(() => {
    const out: { key: string; items: EventView[] }[] = [];
    for (const e of items) {
      const k = dayKey(e.date);
      const last = out[out.length - 1];
      if (last && last.key === k) last.items.push(e); else out.push({ key: k, items: [e] });
    }
    return out;
  }, [items]);

  const toLatest = () => { if (hasNewer) loadMain(); else window.scrollTo({ top: docH(), behavior: 'smooth' }); };
  const bottomPad = canReply ? 'calc(var(--safe-b) + 76px)' : undefined;

  return (
    <div style={{ paddingBottom: bottomPad }}>
      <Header title={name ?? t('conversation.chatN', { id: chatId })} photo sub={muted ? <><Icon name="bellOff" className="inline-ico" /> {t('conversation.mutedSub')}</> : undefined}
        avatar={{ id: chatId, name }} onTitle={() => nav.push({ name: 'contact', chatId })}
        right={<IconButton icon="more" label={t('conversation.menu.label')} onClick={menu} />} />
      <Chips items={FILTERS.map((f) => ({ id: f.id, label: t(f.label) }))} value={filter} onChange={(f) => { setFilter(f); setHasNewer(false); }} />

      {state === 'loading' ? <SkeletonBubbles />
        : state === 'error' ? <ErrorState text={err} onRetry={() => loadMain(jumpTo)} />
          : items.length === 0 ? <Empty icon="chat" title={t('conversation.empty.title')} text={t(FILTER_EMPTY[filter])}
            action={filter !== 'all' ? { label: t('conversation.showAll'), onClick: () => setFilter('all') } : undefined} />
            : (
              <div className="thread">
                {topSentinel}
                {edge === 'older' && <Spinner />}
                {!hasOlder && <div className="thread-edge"><span className="tag mute">{t('conversation.archiveStart')}</span></div>}
                {days.map((d) => (
                  <div key={d.key} className="day">
                    <div className="day-sep">{fmtDay(d.items[0].date)}</div>
                    {d.items.map((e, i) => {
                      const prev = d.items[i - 1];
                      const gap = filter !== 'all' || !prev || prev.isOutgoing !== e.isOutgoing || (e.date ?? 0) - (prev.date ?? 0) > 10 * 60_000;
                      return (
                        <Bubble key={e.id} e={e} gap={gap} flash={flash === e.id}
                          onOpen={() => nav.push({ name: 'event', id: e.id })} onView={() => setView(e)} onMenu={() => bubbleMenu(e)} />
                      );
                    })}
                  </div>
                ))}
                {edge === 'newer' && <Spinner />}
                {bottomSentinel}
              </div>
            )}

      {state === 'ready' && items.length > 0 && (!nearBottom || hasNewer) && (
        <button className="jump-btn" style={{ bottom: canReply ? 'calc(var(--safe-b) + 72px)' : 'calc(var(--safe-b) + 20px)' }} onClick={toLatest} aria-label={t('conversation.toLatest')}>
          <Icon name="arrowDown" />
        </button>
      )}

      {canReply && filter === 'all' && (
        <Composer chatId={chatId} windowOpen={win.open} windowUntil={win.until} replyTo={replyTo} autoFocus={composerFocus.current && state === 'ready'}
          onClearReply={() => setReplyTo(null)} onSent={() => setTimeout(() => loadMain(), 1200)} />
      )}

      {view && <MediaViewer event={view} items={items.filter(viewable)} onClose={() => setView(null)} onDetails={(e) => nav.push({ name: 'event', id: e.id })} />}
      <DateSheet open={sheet === 'date'} onClose={() => setSheet(null)} onPick={(d) => { setSheet(null); loadMain(d); }} />
      <ExportSheet open={sheet === 'export'} onClose={() => setSheet(null)} chatId={chatId} chatName={name} />
    </div>
  );
}

function Bubble({ e, gap, flash, onOpen, onView, onMenu }: { e: EventView; gap: boolean; flash: boolean; onOpen: () => void; onView: () => void; onMenu: () => void }) {
  // Долгое нажатие (500 мс) открывает меню пузыря; обычный тап — карточку события.
  const press = useRef<{ t: ReturnType<typeof setTimeout> | null; fired: boolean }>({ t: null, fired: false });
  const startPress = () => { press.current.fired = false; press.current.t = setTimeout(() => { press.current.fired = true; haptic('medium'); onMenu(); }, 500); };
  const endPress = () => { if (press.current.t) clearTimeout(press.current.t); press.current.t = null; };
  const [showEdits, setShowEdits] = useState(false);
  const mt = e.mediaType;
  const visual = (isPhoto(mt) || isVideo(mt)) && e.hasThumb;
  const round = mt === 'video_note';
  const d = durationOf(e);
  const cls = ['bubble', e.isOutgoing && 'out', e.isDeleted && 'del', gap && 'gap', visual && 'has-media', round && 'round', flash && 'flash'].filter(Boolean).join(' ');
  const sticker = mt === 'sticker';

  return (
    <div id={`m${e.id}`} className={cls} onClick={() => { if (!press.current.fired) onOpen(); }}
      onPointerDown={startPress} onPointerUp={endPress} onPointerLeave={endPress} onPointerCancel={endPress}
      onContextMenu={(ev) => { ev.preventDefault(); endPress(); if (!press.current.fired) { press.current.fired = true; onMenu(); } }}>
      {visual && (
        <div className="b-media" style={{ aspectRatio: String(aspectOf(e)) }} onClick={(ev) => { ev.stopPropagation(); onView(); }}>
          {mt === 'animation' && e.previewable ? <GifVideo e={e} /> : <ThumbImg event={e} />}
          {isVideo(mt) && !(mt === 'animation' && e.previewable) && <span className="play"><Icon name="play" /></span>}
          {d != null && isVideo(mt) && <span className="dur tnum">{fmtDuration(d)}</span>}
        </div>
      )}
      {e.forwardOrigin && <div className="fwd"><Icon name="forward" />{t('conversation.forwarded')}</div>}
      {e.reply && (
        <div className="quote">
          <div className="qs">{e.reply.sender ?? t('conversation.replyFallback')}</div>
          <div className="qt">{e.reply.text ?? t('conversation.messageFallback')}</div>
        </div>
      )}
      {isAudio(mt) && <AudioPlayer e={e} />}
      {mt && !visual && !isAudio(mt) && !sticker && (
        <div className="media-chip">
          <span className="fi" style={{ ['--c' as string]: mediaColor(mt) }}><Icon name={mediaIconName(mt)} /></span>
          <div className="grow">
            <div className="ellipsis" style={{ fontWeight: 500 }}>{e.fileName ?? mediaName(e)}</div>
            {(e.fileSize || d) && <div className="hint tnum" style={{ fontSize: 13 }}>{[d && fmtDuration(d), e.fileSize && fmtSize(e.fileSize)].filter(Boolean).join(' · ')}</div>}
          </div>
        </div>
      )}
      {sticker && <div className="sticker"><StickerView e={e} size={128} /></div>}
      {!sticker && e.html && <div className="b-text" dangerouslySetInnerHTML={{ __html: e.html }} />}
      {!mt && !e.html && <div className="b-text hint"><i>{t('conversation.noText')}</i></div>}
      <div className="b-foot">
        {e.oneTime && <span className="mark fire"><Icon name="flame" />{t('conversation.mark.oneTime')}</span>}
        {e.isDeleted && <span className="mark del"><Icon name="trash" />{t('conversation.mark.deleted')}</span>}
        {e.editCount > 0 && (
          <button className="mark edit" onClick={(ev) => { ev.stopPropagation(); setShowEdits((v) => !v); haptic('select'); }} aria-expanded={showEdits}>
            <Icon name="pencil" />{e.editCount > 1 ? t('conversation.mark.editedN', { n: e.editCount }) : t('conversation.mark.edited')}<Icon name="chevronDown" className={showEdits ? 'rot' : ''} />
          </button>
        )}
        {e.isFavorite && <Icon name="starFill" className="star" />}
        <span className="tnum">{fmtTime(e.date)}</span>
      </div>
      {showEdits && !!e.edits?.length && (
        <div className="b-edits" onClick={(ev) => ev.stopPropagation()}>
          {e.edits.map((ed, i) => (
            <div key={ed.id} className="ver"><small>{t('conversation.editN', { n: i + 1, time: fmtTime(ed.editedAt) })}</small><Diff parts={ed.diff} /></div>
          ))}
        </div>
      )}
    </div>
  );
}
