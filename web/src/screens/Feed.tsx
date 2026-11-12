import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { call } from '../api';
import { useNav, useLayerActive, type FeedKind } from '../nav';
import { useBus } from '../bus';
import type { EventView, Cursor } from '../types';
import { EventRow } from '../components/EventRow';
import { Icon, type IconName } from '../components/Icon';
import { ArchiveBanner } from '../components/ArchiveBanner';
import { Header, IconButton, Chips, Empty, ErrorState, SkeletonList, SectionHeader, ListTail, useInfinite } from '../components/ui';
import { t, type Key } from '../i18n';
import { dayKey, fmtDay } from '../util';
import { usePersistent } from '../storage';

// Подписи — ключи словаря: переводятся при рендере (t()), а не при импорте модуля.
const KINDS: { id: FeedKind; label: Key }[] = [
  { id: 'events', label: 'feed.kind.events' },
  { id: 'deleted', label: 'feed.kind.deleted' },
  { id: 'edited', label: 'feed.kind.edited' },
  { id: 'oneTime', label: 'feed.kind.oneTime' },
  { id: 'favorite', label: 'feed.kind.favorite' },
];
const MEDIA: { id: string; label: Key; icon: IconName }[] = [
  { id: 'any', label: 'feed.media.any', icon: 'inbox' },
  { id: 'text', label: 'feed.media.text', icon: 'chat' },
  { id: 'photo', label: 'feed.media.photo', icon: 'image' },
  { id: 'video', label: 'feed.media.video', icon: 'video' },
  { id: 'voice', label: 'feed.media.voice', icon: 'mic' },
  { id: 'document', label: 'feed.media.document', icon: 'file' },
  { id: 'sticker', label: 'feed.media.sticker', icon: 'smile' },
];

const EMPTY: Record<FeedKind, { icon: IconName; title: Key; text: Key }> = {
  events: { icon: 'inbox', title: 'feed.empty.events.title', text: 'feed.empty.events.text' },
  deleted: { icon: 'trash', title: 'feed.empty.deleted.title', text: 'feed.empty.deleted.text' },
  edited: { icon: 'pencil', title: 'feed.empty.edited.title', text: 'feed.empty.edited.text' },
  oneTime: { icon: 'flame', title: 'feed.empty.oneTime.title', text: 'feed.empty.oneTime.text' },
  favorite: { icon: 'star', title: 'feed.empty.favorite.title', text: 'feed.empty.favorite.text' },
};

export function groupFeed(items: EventView[], kind: FeedKind, seenAt: number) {
  const out: { key: string; ms: number; items: EventView[]; sep: boolean }[] = [];
  let sawNew = false, sepDone = false;
  for (const e of items) {
    const ms = keyOf(e, kind);
    const k = dayKey(ms);
    const isNew = kind === 'events' && seenAt > 0 && (e.eventAt ?? 0) > seenAt;
    if (isNew) sawNew = true;
    const sep = !isNew && sawNew && !sepDone;
    if (sep) sepDone = true;
    const last = out[out.length - 1];
    if (last && last.key === k && !sep) last.items.push(e); else out.push({ key: k, ms, items: [e], sep });
  }
  return out;
}

const keyOf = (e: EventView, kind: FeedKind) =>
  kind === 'events' || kind === 'deleted' ? e.eventAt ?? e.date ?? 0
    : kind === 'edited' ? e.lastEditedAt ?? e.eventAt ?? e.date ?? 0
      : e.date ?? 0;

export function Feed() {
  const nav = useNav();
  const active = useLayerActive();
  const [kind, setKind] = usePersistent<FeedKind>('feed.kind', 'events', (v): v is FeedKind => KINDS.some((k) => k.id === v));
  const [media, setMedia] = usePersistent<string>('feed.media', 'any', (v): v is string => MEDIA.some((m) => m.id === v));
  const [fresh, setFresh] = useState<Set<number>>(new Set());
  const newest = useRef(0);

  useEffect(() => { if (nav.feedIntent) { setKind(nav.feedIntent.kind); setMedia('any'); } }, [nav.feedIntent, setKind, setMedia]);

  const page = useInfinite<EventView>(
    async (cursor: Cursor | null) => {
      const res = await call<{ items: EventView[]; next: Cursor | null; total?: number }>('feed', { kind, media, cursor, limit: 30 });
      // С запасом на расхождение часов: дубли всё равно отсеет dedupe.
      if (!cursor) newest.current = res.items.length ? keyOf(res.items[0], kind) : Date.now() - 5 * 60_000;
      return res;
    },
    [kind, media],
    { cacheKey: `feed.${kind}.${media}` },
  );
  const { items, setItems } = page;

  useEffect(() => {
    if (!active) return;
    const tick = async () => {
      if (document.hidden || !newest.current) return;
      const res = await call<{ items: EventView[] }>('feed', { kind, media, since: newest.current }).catch(() => null);
      if (!res?.items?.length) return;
      newest.current = Math.max(newest.current, ...res.items.map((e) => keyOf(e, kind)));
      setItems((prev) => dedupe([...res.items, ...prev]));
      setFresh(new Set(res.items.map((e) => e.id)));
    };
    const t = setInterval(tick, 12_000);
    const onVisible = () => { if (!document.hidden) tick(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVisible); };
  }, [active, kind, media, setItems]);

  useBus((ev) => {
    if (ev.type === 'wiped') page.reload();
    if (ev.type === 'eventDeleted') setItems((p) => p.filter((e) => e.id !== ev.id));
    if (ev.type === 'historyDeleted') page.reload();
    if (ev.type === 'chatDeleted') setItems((p) => p.filter((e) => e.chatId !== ev.chatId));
    if (ev.type === 'favorite') {
      setItems((p) => (kind === 'favorite' && !ev.value
        ? p.filter((e) => e.id !== ev.id)
        : p.map((e) => (e.id === ev.id ? { ...e, isFavorite: ev.value } : e))));
    }
  });

  const [seenAt] = useState(() => nav.boot.settings.lastSeenEventsAt ?? 0);
  const { patchCounts } = nav;
  const markSeen = useCallback((list: EventView[]) => {
    const top = Math.max(0, ...list.map((e) => e.eventAt ?? 0));
    if (!top) return;
    patchCounts({ unreadEvents: 0 });
    call('action', { type: 'seen', upTo: top }).catch(() => {});
  }, [patchCounts]);
  useEffect(() => {
    if (active && kind === 'events' && !page.loading && !page.stale && items.length) markSeen(items.slice(0, 50));
  }, [active, kind, page.loading, page.stale, items, markSeen]);

  const groups = useMemo(() => groupFeed(items, kind, seenAt), [items, kind, seenAt]);

  const pickMedia = async () => {
    const v = await nav.choose({ title: t('feed.media.title'), selected: media, options: MEDIA.map((m) => ({ value: m.id, label: t(m.label), icon: m.icon })) });
    if (v != null) setMedia(v);
  };

  const c = nav.boot.counts;
  const m = MEDIA.find((x) => x.id === media)!;
  const empty = media === 'any'
    ? { icon: EMPTY[kind].icon, title: t(EMPTY[kind].title), text: t(EMPTY[kind].text) }
    : { icon: m.icon, title: t('feed.empty.filtered.title'), text: t('feed.empty.filtered.text', { filter: t(m.label) }) };

  return (
    <>
      <Header large title={t('feed.title')} sub={page.stale ? t('feed.updating') : undefined}
        right={<>
          <IconButton icon="filter" label={t('feed.media.title')} onClick={pickMedia} dot={media !== 'any'} />
          <IconButton icon="search" label={t('feed.search')} onClick={() => nav.push({ name: 'search' })} />
        </>} />
      <ArchiveBanner />
      <Chips items={KINDS.map((k) => ({ id: k.id, label: t(k.label), n: k.id === 'deleted' ? c.deleted : k.id === 'edited' ? c.edited : k.id === 'favorite' ? c.favorite : null }))}
        value={kind} onChange={setKind}
        lead={media !== 'any' && (
          <button className="chip outline" onClick={() => setMedia('any')} aria-label={t('feed.media.reset')}>
            <Icon name={m.icon} />{t(m.label)}<Icon name="close" />
          </button>
        )} />

      {page.loading ? <SkeletonList />
        : page.error && !items.length ? <ErrorState text={page.error} onRetry={page.reload} />
          : !items.length ? <Empty {...empty} action={media !== 'any' ? { label: t('feed.resetFilter'), onClick: () => setMedia('any') } : undefined} />
            : groups.map((g, gi) => (
              <Fragment key={`${g.key}:${gi}`}>
                {g.sep && <div className="seen-sep">{t('feed.seenEarlier')}</div>}
                {(!g.sep || groups[gi - 1]?.key !== g.key) && <SectionHeader>{fmtDay(g.ms)}</SectionHeader>}
                <div className="sec">
                  {g.items.map((e) => <EventRow key={e.id} e={e} fresh={fresh.has(e.id)} onClick={() => nav.push({ name: 'event', id: e.id })} />)}
                </div>
              </Fragment>
            ))}
      {page.sentinel}
      <ListTail more={page.more} error={items.length ? page.error : null} onRetry={page.loadMore} />
    </>
  );
}

function dedupe(list: EventView[]): EventView[] {
  const seen = new Set<number>();
  return list.filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)));
}
