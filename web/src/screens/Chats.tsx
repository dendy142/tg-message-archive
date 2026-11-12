import { useMemo, useState } from 'react';
import { call } from '../api';
import { useNav, useLayerActive } from '../nav';
import { useBus } from '../bus';
import type { ChatView, Cursor } from '../types';
import { Icon } from '../components/Icon';
import { Header, Avatar, Empty, ErrorState, SkeletonList, ListTail, useInfinite, useOnReturn } from '../components/ui';
import { t } from '../i18n';
import { count, fmtSmart, W } from '../util';

const PAGE = 100;
const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е');

export function Chats() {
  const nav = useNav();
  const [q, setQ] = useState('');

  const page = useInfinite<ChatView>(async (cursor: Cursor | null) => {
    const offset = cursor?.id ?? 0;
    const r = await call<{ items: ChatView[]; total: number }>('chats', { limit: PAGE, offset });
    const loaded = offset + r.items.length;
    return { items: r.items, next: loaded < r.total && r.items.length ? { k: 0, id: loaded } : null, total: r.total };
  }, [], { cacheKey: 'chats' });
  const { items, setItems } = page;

  useOnReturn(useLayerActive(), () => page.refresh((c) => c.chatId));

  useBus((ev) => {
    if (ev.type === 'muted') setItems((p) => p.map((c) => (c.chatId === ev.chatId ? { ...c, muted: ev.value } : c)));
    if (ev.type === 'historyDeleted' || ev.type === 'chatDeleted' || ev.type === 'eventDeleted' || ev.type === 'wiped') page.reload();
  });

  const shown = useMemo(() => {
    const s = norm(q.trim());
    return s ? items.filter((c) => norm(c.chatName ?? String(c.chatId)).includes(s)) : items;
  }, [items, q]);
  const total = page.total ?? items.length;

  return (
    <>
      <Header large title={t('chats.title')} sub={page.loading ? undefined : t('chats.sub', { chats: count(total, W.chat) })} />
      {items.length > 6 && (
        <label className="field">
          <Icon name="search" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('chats.searchPlaceholder')} enterKeyHint="search" />
          {q && <button className="clear" onClick={() => setQ('')} aria-label={t('chats.clear')}><Icon name="close" strokeWidth={3} /></button>}
        </label>
      )}
      {page.loading ? <SkeletonList />
        : page.error && !items.length ? <ErrorState text={page.error} onRetry={page.reload} />
          : !items.length ? <Empty icon="chat" title={t('chats.empty.title')} text={t('chats.empty.text')} />
            : !shown.length ? <Empty icon="search" title={t('chats.notFound.title')} text={t('chats.notFound.text', { q: q.trim() })} />
              : (
                <div className="sec">
                  {shown.map((c) => (
                    <button key={c.chatId} className="cell tap av ev" onClick={() => nav.push({ name: 'chat', chatId: c.chatId, chatName: c.chatName })}>
                      <Avatar id={c.chatId} name={c.chatName} photo={c.hasPhoto} />
                      <div className="grow">
                        <div className="top">
                          <span className="name">{c.chatName ?? t('chats.chatN', { id: c.chatId })}</span>
                          {c.muted && <Icon name="bellOff" className="muted-ico" />}
                          <span className="time tnum">{fmtSmart(c.lastAt)}</span>
                        </div>
                        <div className="pre">
                          <div className="txt one">
                            {count(c.total, W.msg)}{c.edited > 0 && <> · <span className="orange">{count(c.edited, W.edit)}</span></>}
                          </div>
                          {(c.unread ?? 0) > 0 && <span className="count new" aria-label={t('chats.newEvents', { n: c.unread })}>{c.unread}</span>}
                          {c.deleted > 0 && (
                            <span className={`count${c.muted ? ' muted' : ''}`} title={t('chats.deleted', { n: c.deleted })} aria-label={t('chats.deleted', { n: c.deleted })}>
                              <Icon name="trash" strokeWidth={2.6} />{c.deleted}
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
      {page.sentinel}
      <ListTail more={page.more} error={items.length ? page.error : null} onRetry={page.loadMore} />
    </>
  );
}
