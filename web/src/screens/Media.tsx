import { Fragment, useMemo, useState } from 'react';
import { call } from '../api';
import { useNav, useLayerActive } from '../nav';
import { useBus } from '../bus';
import type { EventView, Cursor } from '../types';
import { Icon, mediaColor, mediaIconName } from '../components/Icon';
import { Header, Chips, Empty, ErrorState, SkeletonGrid, SkeletonList, ListTail, useInfinite, useOnReturn } from '../components/ui';
import { ThumbImg, AudioPlayer, FileTile, durationOf, isAudio, isPhoto, isVideo, mediaName } from '../components/Media';
import { MediaViewer, viewable } from '../components/Viewer';
import { fmtSmart, fmtDuration, fmtMonth, fmtSize, monthKey } from '../util';
import { usePersistent } from '../storage';
import { t, type Key } from '../i18n';

type Group = 'all' | 'photo' | 'video' | 'voice' | 'document';
const GROUPS: { id: Group; label: Key }[] = [
  { id: 'all', label: 'media.group.all' }, { id: 'photo', label: 'media.group.photo' }, { id: 'video', label: 'media.group.video' },
  { id: 'voice', label: 'media.group.voice' }, { id: 'document', label: 'media.group.document' },
];

export function Media({ chatId, chatName }: { chatId?: number; chatName?: string | null }) {
  const nav = useNav();
  const [group, setGroup] = usePersistent<Group>('media.group', 'all', (v): v is Group => GROUPS.some((g) => g.id === v));
  const [deletedOnly, setDeletedOnly] = usePersistent<boolean>('media.deletedOnly', false, (v): v is boolean => typeof v === 'boolean');
  const [view, setView] = useState<EventView | null>(null);

  const page = useInfinite<EventView>(
    (cursor: Cursor | null) => call<{ items: EventView[]; next: Cursor | null }>('media', {
      group, deletedOnly, cursor, limit: 60, ...(chatId != null ? { chatId } : {}),
    }),
    [group, deletedOnly, chatId],
  );
  const { items, setItems } = page;
  const asList = group === 'voice' || group === 'document';

  useOnReturn(useLayerActive(), () => page.refresh((e) => e.id));

  useBus((ev) => {
    if (ev.type === 'wiped') page.reload();
    if (ev.type === 'eventDeleted') setItems((p) => p.filter((e) => e.id !== ev.id));
    if (ev.type === 'historyDeleted') page.reload();
    if (ev.type === 'chatDeleted') setItems((p) => p.filter((e) => e.chatId !== ev.chatId));
  });

  const months = useMemo(() => {
    const out: { key: string; ms: number; items: EventView[] }[] = [];
    for (const e of items) {
      const k = monthKey(e.date);
      const last = out[out.length - 1];
      if (last && last.key === k) last.items.push(e); else out.push({ key: k, ms: e.date ?? 0, items: [e] });
    }
    return out;
  }, [items]);

  const open = (e: EventView) => {
    if ((isPhoto(e.mediaType) || isVideo(e.mediaType)) && (e.previewable || e.hasThumb)) setView(e);
    else nav.push({ name: 'event', id: e.id });
  };
  const deletedToggle = (
    <button className={`chip sm danger${deletedOnly ? ' on' : ''}`} aria-pressed={deletedOnly} onClick={() => setDeletedOnly((v) => !v)}>
      <Icon name="trash" />{t('media.deleted')}
    </button>
  );
  const empty = deletedOnly
    ? { title: t('media.empty.deleted.title'), text: t('media.empty.deleted.text') }
    : { title: t('media.empty.none.title'), text: t('media.empty.none.text') };

  return (
    <>
      {chatId != null
        ? <Header title={t('media.titleChat')} sub={chatName ?? undefined} right={deletedToggle} />
        : <Header large title={t('media.title')} right={deletedToggle} />}
      <Chips items={GROUPS.map((g) => ({ id: g.id, label: t(g.label) }))} value={group} onChange={setGroup} />

      {page.loading ? (asList ? <SkeletonList rows={6} /> : <SkeletonGrid />)
        : page.error && !items.length ? <ErrorState text={page.error} onRetry={page.reload} />
          : !items.length ? <Empty icon="image" {...empty} action={deletedOnly ? { label: t('media.showAll'), onClick: () => setDeletedOnly(false) } : undefined} />
            : months.map((mo) => (
              <Fragment key={mo.key}>
                <div className="month">{fmtMonth(mo.ms)}</div>
                {asList ? (
                  <div className="sec">
                    {mo.items.map((e) => <ListItem key={e.id} e={e} onOpen={() => nav.push({ name: 'event', id: e.id })} />)}
                  </div>
                ) : (
                  <div className="gallery">
                    {mo.items.map((e) => <GridCell key={e.id} e={e} onClick={() => open(e)} />)}
                  </div>
                )}
              </Fragment>
            ))}
      {page.sentinel}
      <ListTail more={page.more} error={items.length ? page.error : null} onRetry={page.loadMore} />
      {view && <MediaViewer event={view} items={items.filter(viewable)} onClose={() => setView(null)} onDetails={(e) => nav.push({ name: 'event', id: e.id })} />}
    </>
  );
}

function GridCell({ e, onClick }: { e: EventView; onClick: () => void }) {
  const d = durationOf(e);
  return (
    <button className="cell-m" onClick={onClick} aria-label={mediaName(e)}>
      {e.hasThumb ? <ThumbImg event={e} /> : (
        <span className="ph-tile" style={{ ['--c' as string]: mediaColor(e.mediaType) }}>
          <Icon name={mediaIconName(e.mediaType)} />
          <span>{d ? fmtDuration(d) : e.fileSize ? fmtSize(e.fileSize) : mediaName(e)}</span>
        </span>
      )}
      {isVideo(e.mediaType) && e.hasThumb && <span className="dur tnum"><Icon name="play" />{d ? fmtDuration(d) : ''}</span>}
      {e.isDeleted && <span className="corner del" title={t('media.cornerDeleted')}><Icon name="trash" strokeWidth={2.4} /></span>}
      {e.oneTime && <span className="corner fire" title={t('media.cornerOneTime')}><Icon name="flame" strokeWidth={2.4} /></span>}
    </button>
  );
}

function ListItem({ e, onOpen }: { e: EventView; onOpen: () => void }) {
  const who = e.isOutgoing ? t('media.you') : e.senderName ?? e.chatName ?? t('media.contact');
  return (
    <div className="cell media-row">
      <div className="grow">
        {isAudio(e.mediaType) ? <AudioPlayer e={e} /> : <button className="plain-btn" onClick={onOpen}><FileTile e={e} /></button>}
        <button className="mrow-meta" onClick={onOpen}>
          {e.isDeleted && <span className="tag del"><Icon name="trash" />{t('media.tagDeleted')}</span>}
          <span className="ellipsis">{who} · {fmtSmart(e.date)}</span>
          <Icon name="chevronRight" className="chev" />
        </button>
      </div>
    </div>
  );
}
