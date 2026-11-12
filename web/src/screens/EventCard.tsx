import { useState, type ReactNode } from 'react';
import { call, ApiError } from '../api';
import { useNav } from '../nav';
import { emit, useBus } from '../bus';
import { confirm, haptic, openTgLink, tg } from '../telegram';
import { shareEvent } from '../share';
import type { EventView, EditView } from '../types';
import { Header, IconButton, Cell, SectionHeader, SectionFooter, Empty, ErrorState, Spinner, useAsync } from '../components/ui';
import { Icon } from '../components/Icon';
import { Diff } from '../components/Diff';
import { MediaHero, AudioPlayer, FileTile, ThumbImg, StickerView, isAudio, isPhoto, isVideo, mediaName } from '../components/Media';
import { MediaViewer, viewable } from '../components/Viewer';
import { t } from '../i18n';
import { archiveLink, count, dayKey, fmtDateTime, fmtFull, fmtSize, plural, W } from '../util';

interface Resp { event: EventView; edits: EditView[]; album: EventView[] | null }

export function EventCard({ id }: { id: number }) {
  const nav = useNav();
  const { data, setData, error, loading, reload } = useAsync(() => call<Resp>('event', { id }), [id]);
  const [view, setView] = useState<EventView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [gone, setGone] = useState(false);
  useBus((ev) => { if (ev.type === 'chatDeleted' && data?.event.chatId === ev.chatId) setGone(true); });

  if (!data || gone) {
    return (
      <>
        <Header title={t('event.title')} />
        {gone ? <Empty icon="trash" title={t('event.notFound.title')} text={t('event.notFound.text')} />
          : loading ? <Spinner />
          : /не найдено|not found/i.test(error ?? '') ? <Empty icon="trash" title={t('event.notFound.title')} text={t('event.notFound.text')} />
            : <ErrorState text={error} onRetry={() => reload()} />}
      </>
    );
  }
  const e = data.event;
  const name = e.chatName ?? e.senderName ?? t('event.contactFallback');

  const toggleFav = async () => {
    try {
      const r = await call<{ favorite: boolean }>('action', { type: 'favorite', id });
      setData({ ...data, event: { ...e, isFavorite: r.favorite } });
      emit({ type: 'favorite', id, value: r.favorite });
      haptic('select');
      nav.toast(t(r.favorite ? 'event.fav.added' : 'event.fav.removed'));
    } catch (ex) { nav.toast((ex as ApiError).message, 'err'); }
  };
  const sendToMe = async () => {
    setBusy('send');
    try { await call('sendToMe', { id }); nav.toast(t('event.sent'), 'ok'); haptic('success'); }
    catch (ex) { nav.toast((ex as ApiError).message, 'err'); haptic('error'); }
    finally { setBusy(null); }
  };
  const del = async () => {
    if (!(await confirm(t('event.delete.confirm')))) return;
    setBusy('del');
    try {
      await call('action', { type: 'deleteEvent', id });
      haptic('warning');
      emit({ type: 'eventDeleted', id });
      nav.toast(t('event.delete.done'));
      nav.pop();
    } catch (ex) { nav.toast((ex as ApiError).message, 'err'); setBusy(null); }
  };
  const share = () => shareEvent(nav, id);
  const openInChat = () => nav.push({ name: 'chat', chatId: e.chatId, chatName: e.chatName, jumpTo: e.date ? dayKey(e.date) : undefined, focusId: e.id });

  const visual = (isPhoto(e.mediaType) || isVideo(e.mediaType)) && (e.hasThumb || e.previewable);
  const lat = Number(e.mediaMeta?.lat), lon = Number(e.mediaMeta?.lon);

  let body: ReactNode = null;
  if (e.mediaType === 'sticker') body = <StickerView e={e} size={160} />;
  else if (e.html) body = <div className="msg-body" dangerouslySetInnerHTML={{ __html: e.html }} />;
  else if (!e.mediaType) body = <div className="msg-body muted">{t('event.noText')}</div>;

  return (
    <>
      <Header title={name} sub={e.isOutgoing ? t('event.yourMessage') : fmtDateTime(e.date)} avatar={{ id: e.chatId, name }}
        onTitle={() => nav.push({ name: 'contact', chatId: e.chatId })}
        right={<IconButton icon={e.isFavorite ? 'starFill' : 'star'} label={t(e.isFavorite ? 'event.fav.remove' : 'event.fav.add')} on={e.isFavorite} onClick={toggleFav} />} />

      <div className="tags pad" style={{ marginBottom: 10 }}>
        {e.isDeleted && <span className="tag del"><Icon name="trash" />{e.deletedAt ? t('event.tag.deletedAt', { date: fmtDateTime(e.deletedAt) }) : t('event.tag.deleted')}</span>}
        {e.editCount > 0 && <span className="tag edit"><Icon name="pencil" />{e.editCount > 1 ? t('event.tag.editedTimes', { times: `${e.editCount} ${plural(e.editCount, W.times)}` }) : t('event.tag.edited')}</span>}
        {e.oneTime && <span className="tag fire"><Icon name="flame" />{t('event.tag.oneTime')}</span>}
        {e.isOutgoing && <span className="tag mute"><Icon name="user" />{t('event.tag.yours')}</span>}
        {!e.isDeleted && !e.editCount && !e.oneTime && !e.isOutgoing && <span className="tag accent"><Icon name="check" />{t('event.tag.saved')}</span>}
      </div>

      <div className="card">
        {visual && <MediaHero e={e} onOpen={() => setView(e)} />}
        {e.forwardOrigin && <div className="fwd"><Icon name="forward" />{t('event.forwarded')}</div>}
        {e.reply && (
          <div className="quote">
            <div className="qs">{e.reply.sender ?? t('event.replyFallback')}</div>
            <div className="qt">{e.reply.text ?? t('event.messageFallback')}</div>
          </div>
        )}
        {isAudio(e.mediaType) && <div style={{ marginBottom: e.html ? 10 : 0 }}><AudioPlayer e={e} /></div>}
        {e.mediaType && !visual && !isAudio(e.mediaType) && e.mediaType !== 'sticker' && (
          <div style={{ marginBottom: e.html ? 10 : 0 }}><FileTile e={e} /></div>
        )}
        {body}
      </div>
      {visual && !e.previewable && (
        <div className="pad" style={{ marginTop: 10 }}>
          <div className="note"><Icon name="info" />{t('event.bigFile')}</div>
        </div>
      )}

      {data.album && <>
        <SectionHeader>{t('event.album', { files: count(data.album.length, W.file) })}</SectionHeader>
        <div className="sec album">
          <div className="gallery">
            {data.album.map((a) => (
              <button key={a.id} className="cell-m" onClick={() => (a.id === e.id ? setView(a) : nav.push({ name: 'event', id: a.id }))}>
                <ThumbImg event={a} />
                {isVideo(a.mediaType) && <span className="play sm"><Icon name="play" /></span>}
                {a.isDeleted && <span className="corner del"><Icon name="trash" strokeWidth={2.4} /></span>}
              </button>
            ))}
          </div>
        </div>
      </>}

      {data.edits.length > 0 && <>
        <SectionHeader>{t('event.edits.title', { n: data.edits.length })}</SectionHeader>
        <div className="sec">
          {data.edits.map((ed, i) => (
            <div key={ed.id} className="cell ver-cell">
              <div className="grow">
                <div className="s" style={{ marginBottom: 4 }}>
                  {t(ed.mediaReplaced ? 'event.edits.lineReplaced' : 'event.edits.line', { n: i + 1, date: fmtDateTime(ed.editedAt) })}
                </div>
                <Diff parts={ed.diff} />
              </div>
            </div>
          ))}
        </div>
        <SectionFooter><span className="diff-legend"><del>{t('event.diff.was')}</del> → <ins>{t('event.diff.now')}</ins></span></SectionFooter>
      </>}

      <SectionHeader>{t('event.details')}</SectionHeader>
      <div className="sec">
        <Cell title={t(e.isOutgoing ? 'event.details.sent' : 'event.details.received')} value={fmtFull(e.date)} />
        {e.isDeleted && <Cell title={t('event.tag.deleted')} value={fmtFull(e.deletedAt)} />}
        {e.lastEditedAt && <Cell title={t('event.details.lastEdit')} value={fmtFull(e.lastEditedAt)} />}
        {!e.isOutgoing && e.senderName && e.senderName !== name && <Cell title={t('event.details.sender')} value={e.senderName} />}
        {e.mediaType && <Cell title={t('event.details.type')} value={[mediaName(e), e.fileSize ? fmtSize(e.fileSize) : null].filter(Boolean).join(' · ')} />}
        {e.mirror && <Cell title={t('event.details.mirror')} tone="accent" onClick={() => openTgLink(archiveLink(e.mirror!))} right={<Icon name="external" className="hint" />} />}
        {Number.isFinite(lat) && Number.isFinite(lon) && (
          <Cell title={t('event.details.map')} tone="accent" onClick={() => (tg?.openLink ? tg.openLink(`https://maps.google.com/?q=${lat},${lon}`) : window.open(`https://maps.google.com/?q=${lat},${lon}`, '_blank'))} right={<Icon name="external" className="hint" />} />
        )}
      </div>

      <div className="sec" style={{ marginTop: 16 }}>
        {e.mediaType && <Cell icon="download" title={t(busy === 'send' ? 'event.act.sending' : 'event.act.sendToMe')} tone="accent" onClick={busy ? undefined : sendToMe} />}
        <Cell icon="chat" title={t('event.act.showInChat')} tone="accent" onClick={openInChat} />
        <Cell icon="share" title={t('event.act.share')} tone="accent" onClick={share} />
        <Cell icon="user" title={t('event.act.profile')} tone="accent" onClick={() => nav.push({ name: 'contact', chatId: e.chatId })} />
      </div>
      <div className="sec" style={{ marginTop: 16 }}>
        <Cell icon="trash" title={t(busy === 'del' ? 'event.delete.busy' : 'event.delete.action')} tone="danger" onClick={busy ? undefined : del} />
      </div>
      <SectionFooter>{t('event.delete.footer')}</SectionFooter>

      {view && <MediaViewer event={view} items={data.album?.filter(viewable)} onClose={() => setView(null)}
        onDetails={data.album ? (x) => { if (x.id !== id) nav.push({ name: 'event', id: x.id }); } : undefined} />}
    </>
  );
}
