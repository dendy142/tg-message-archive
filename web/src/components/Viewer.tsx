import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import type { EventView } from '../types';
import { useBackButton, haptic } from '../telegram';
import { call, ApiError } from '../api';
import { cachedFull, fileErrorText, loadFull } from '../files';
import { useNav } from '../nav';
import { shareEvent } from '../share';
import { Icon } from './Icon';
import { isPhoto, isVideo } from './Media';
import { fmtDateTime } from '../util';
import { t } from '../i18n';

const MAX_SCALE = 4;
const SWIPE_PX = 40;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

export const viewable = (e: EventView) => (isPhoto(e.mediaType) || isVideo(e.mediaType)) && (e.previewable || e.hasThumb);

export function MediaViewer({ event, items, onClose, onDetails }: {
  event: EventView; items?: EventView[]; onClose: () => void; onDetails?: (e: EventView) => void;
}) {
  const nav = useNav();
  // Список фиксируется при открытии: подгрузка в ленте под просмотрщиком не сдвигает листание.
  const [list] = useState(() => (items?.length ? items : [event]));
  const [index, setIndex] = useState(() => Math.max(0, list.findIndex((x) => x.id === event.id)));
  const cur = list[Math.min(index, list.length - 1)];
  const [src, setSrc] = useState<string | null>(() => cachedFull(cur.id));
  const [err, setErr] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [view, setView] = useState({ s: 1, x: 0, y: 0 });
  const [drag, setDrag] = useState(0);
  const video = isVideo(cur.mediaType);

  useBackButton(onClose);

  useEffect(() => {
    let alive = true;
    setView({ s: 1, x: 0, y: 0 });
    setErr(cur.previewable ? null : fileErrorText(new ApiError('', 'TOO_LARGE', { code: 'TOO_LARGE' })));
    setSrc(cachedFull(cur.id));
    if (cur.previewable) loadFull(cur.id).then((d) => { if (alive) setSrc(d); }).catch((e) => { if (alive) setErr(fileErrorText(e)); });
    for (const n of [list[index - 1], list[index + 1]]) if (n?.previewable && isPhoto(n.mediaType)) loadFull(n.id).catch(() => {});
    return () => { alive = false; };
  }, [cur.id, cur.previewable, index, list]);

  const go = useCallback((d: number) => {
    const next = index + d;
    if (next < 0 || next >= list.length) return;
    setIndex(next);
    haptic('select');
  }, [index, list.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'ArrowLeft') go(-1); if (e.key === 'ArrowRight') go(1); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go]);

  const pts = useRef(new Map<number, { x: number; y: number }>());
  const g = useRef({ x0: 0, y0: 0, dist0: 0, s0: 1, tx0: 0, ty0: 0, lastTap: 0, moved: false });
  const dist = () => { const [a, b] = [...pts.current.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };

  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (video && (e.target as HTMLElement).tagName === 'VIDEO') return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.current.size === 2) { g.current.dist0 = dist(); g.current.s0 = view.s; }
    if (pts.current.size === 1) Object.assign(g.current, { x0: e.clientX, y0: e.clientY, tx0: view.x, ty0: view.y, moved: false });
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (!pts.current.has(e.pointerId)) return;
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const dx = e.clientX - g.current.x0, dy = e.clientY - g.current.y0;
    if (Math.abs(dx) > 8 || Math.abs(dy) > 8) g.current.moved = true;
    if (pts.current.size === 2 && g.current.dist0 && !video) {
      const s = clamp(g.current.s0 * (dist() / g.current.dist0), 1, MAX_SCALE);
      setView((v) => (s === 1 ? { s: 1, x: 0, y: 0 } : { ...v, s }));
    } else if (pts.current.size === 1) {
      if (view.s > 1) setView((v) => ({ ...v, x: g.current.tx0 + dx, y: g.current.ty0 + dy }));
      else if (list.length > 1) setDrag(dx);
    }
  };
  const up = (e: PointerEvent<HTMLDivElement>) => {
    if (!pts.current.has(e.pointerId)) return;
    const wasSingle = pts.current.size === 1;
    pts.current.delete(e.pointerId);
    if (!wasSingle) return;
    const dx = e.clientX - g.current.x0;
    setDrag(0);
    if (view.s === 1 && Math.abs(dx) > SWIPE_PX) { go(dx < 0 ? 1 : -1); return; }
    if (g.current.moved || video) return;
    const now = Date.now();
    if (now - g.current.lastTap < 300) {
      g.current.lastTap = 0;
      setView((v) => (v.s > 1 ? { s: 1, x: 0, y: 0 } : { s: 2.5, x: 0, y: 0 }));
    } else g.current.lastTap = now;
  };

  const sendToMe = async () => {
    setSending(true);
    try { await call('sendToMe', { id: cur.id }); nav.toast(t('viewer.sentToChat'), 'ok'); haptic('success'); }
    catch (e) { nav.toast((e as ApiError).message, 'err'); haptic('error'); }
    finally { setSending(false); }
  };

  return (
    <div className="viewer" role="dialog" aria-modal="true">
      <div className="v-top">
        <button className="v-btn" onClick={onClose} aria-label={t('viewer.close')}><Icon name="close" /></button>
        <div className="v-who">
          <b className="ellipsis">{cur.isOutgoing ? t('viewer.you') : cur.senderName ?? cur.chatName ?? t('ui.event.contact')}</b>
          <span>{cur.isDeleted ? t('viewer.dateDeleted', { date: fmtDateTime(cur.date) }) : fmtDateTime(cur.date)}</span>
        </div>
        <button className="v-btn" onClick={() => shareEvent(nav, cur.id)} aria-label={t('viewer.share')}><Icon name="share" /></button>
        {!err && <button className="v-btn" onClick={sendToMe} disabled={sending} aria-label={t('viewer.sendToMe')}><Icon name="download" /></button>}
        {onDetails && <button className="v-btn" onClick={() => { onClose(); onDetails(cur); }} aria-label={t('viewer.details')}><Icon name="info" /></button>}
      </div>
      <div className="v-stage" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        {err ? (
          <div className="v-msg" onPointerDown={(e) => e.stopPropagation()}>
            {err}
            <button className="btn" onClick={sendToMe} disabled={sending}><Icon name="download" />{t('viewer.sendToMe')}</button>
          </div>
        ) : !src ? <div className="spin" />
          : video ? <video key={cur.id} src={src} controls autoPlay playsInline style={{ transform: `translateX(${drag}px)` }} />
            : <img key={cur.id} src={src} alt="" draggable={false}
              style={{ transform: `translate(${view.x + drag}px, ${view.y}px) scale(${view.s})`, transition: drag || pts.current.size ? 'none' : 'transform .18s ease' }} />}
      </div>
      {list.length > 1 && (
        <div className="v-bot">
          <button className="v-btn" onClick={() => go(-1)} disabled={index === 0} aria-label={t('viewer.prev')}><Icon name="chevronRight" className="flip" /></button>
          <span className="v-count tnum">{t('viewer.counter', { n: index + 1, total: list.length })}</span>
          <button className="v-btn" onClick={() => go(1)} disabled={index === list.length - 1} aria-label={t('viewer.next')}><Icon name="chevronRight" /></button>
        </div>
      )}
    </div>
  );
}
