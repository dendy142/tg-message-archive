import { useEffect, useRef, useState } from 'react';
import { call } from '../api';
import { useNav } from '../nav';
import { useBus } from '../bus';
import type { EventView, Cursor } from '../types';
import { EventRow } from '../components/EventRow';
import { Icon } from '../components/Icon';
import { Header, Chips, Cell, Empty, ErrorState, SkeletonList, SectionHeader, ListTail, useInfinite } from '../components/ui';
import { t, type Key } from '../i18n';
import { count, dayKey, W } from '../util';

type Kind = 'all' | 'deleted' | 'edited' | 'favorite';
const KINDS: { id: Kind; label: Key }[] = [
  { id: 'all', label: 'search.kind.all' }, { id: 'deleted', label: 'search.kind.deleted' }, { id: 'edited', label: 'search.kind.edited' }, { id: 'favorite', label: 'search.kind.favorite' },
];
const RECENT_KEY = 'search.recent';

function readRecent(): string[] {
  try { const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 6) : []; } catch { return []; }
}
function saveRecent(list: string[]) { try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 6))); } catch { /* приватный режим */ } }

export function Search({ initial, chatId, chatName }: { initial?: string; chatId?: number; chatName?: string | null }) {
  const nav = useNav();
  const [q, setQ] = useState(initial ?? '');
  const [query, setQuery] = useState(initial ?? '');
  const [kind, setKind] = useState<Kind>('all');
  const [recent, setRecent] = useState<string[]>(readRecent);
  const input = useRef<HTMLInputElement | null>(null);

  useEffect(() => { if (!initial) input.current?.focus(); }, [initial]);
  useEffect(() => { const t = setTimeout(() => setQuery(q.trim()), 350); return () => clearTimeout(t); }, [q]);

  const page = useInfinite<EventView>(
    async (cursor: Cursor | null) => (query
      ? call<{ items: EventView[]; next: Cursor | null; total: number | null }>('search', { q: query, kind, cursor, limit: 30, ...(chatId != null ? { chatId } : {}) })
      : { items: [], next: null, total: null }),
    [query, kind, chatId],
  );
  const { items, setItems } = page;

  useBus((ev) => {
    if (ev.type === 'wiped') setItems([]);
    if (ev.type === 'eventDeleted') setItems((p) => p.filter((e) => e.id !== ev.id));
    if (ev.type === 'chatDeleted') setItems((p) => p.filter((e) => e.chatId !== ev.chatId));
    if (ev.type === 'favorite') setItems((p) => p.map((e) => (e.id === ev.id ? { ...e, isFavorite: ev.value } : e)));
  });

  const remember = () => {
    if (!query) return;
    const next = [query, ...recent.filter((r) => r.toLowerCase() !== query.toLowerCase())].slice(0, 6);
    setRecent(next); saveRecent(next);
  };
  const words = query.split(/\s+/).filter(Boolean);
  const open = (e: EventView) => (chatId != null
    ? nav.push({ name: 'chat', chatId, chatName, jumpTo: e.date ? dayKey(e.date) : undefined, focusId: e.id })
    : nav.push({ name: 'event', id: e.id }));

  return (
    <>
      <Header title={t(chatId != null ? 'search.titleInChat' : 'search.title')} sub={chatId != null ? chatName ?? undefined : undefined} />
      <label className="field">
        <Icon name="search" />
        <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('search.placeholder')} enterKeyHint="search"
          onKeyDown={(e) => { if (e.key === 'Enter') { setQuery(q.trim()); (e.target as HTMLInputElement).blur(); } }} />
        {q && <button className="clear" onClick={() => { setQ(''); setQuery(''); input.current?.focus(); }} aria-label={t('search.clear')}><Icon name="close" strokeWidth={3} /></button>}
      </label>
      <Chips items={KINDS.map((k) => ({ id: k.id, label: t(k.label) }))} value={kind} onChange={setKind} />

      {!query ? (
        recent.length ? <>
          <SectionHeader right={<button className="link-btn" onClick={() => { setRecent([]); saveRecent([]); }}>{t('search.clear')}</button>}>{t('search.recent')}</SectionHeader>
          <div className="sec">
            {recent.map((r) => <Cell key={r} icon="clock" title={r} onClick={() => { setQ(r); setQuery(r); }} />)}
          </div>
        </> : <Empty icon="search" title={t('search.hint.title')} text={t('search.hint.text')} />
      ) : page.loading ? <SkeletonList rows={5} />
        : page.error && !items.length ? <ErrorState text={page.error} onRetry={page.reload} />
          : !items.length ? <Empty icon="search" title={t('search.none.title')} text={t(kind === 'all' ? 'search.none.tryOther' : 'search.none.tryAll')}
            action={kind !== 'all' ? { label: t('search.everywhere'), onClick: () => setKind('all') } : undefined} />
            : <>
              <SectionHeader>{page.total != null ? t('search.found', { results: count(page.total, W.result) }) : t('search.results')}</SectionHeader>
              <div className="sec">
                {items.map((e) => <EventRow key={e.id} e={e} words={words} onClick={() => { remember(); open(e); }} />)}
              </div>
            </>}
      {page.sentinel}
      <ListTail more={page.more} error={items.length ? page.error : null} onRetry={page.loadMore} />
    </>
  );
}
