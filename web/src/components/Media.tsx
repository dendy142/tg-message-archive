import { useEffect, useRef, useState, type MouseEvent } from 'react';
import type { EventView } from '../types';
import { cachedFull, cachedThumb, canPlayOgg, fileErrorText, loadFull, loadThumb, loadVoiceWav } from '../files';
import { Icon, mediaColor, mediaIconName } from './Icon';
import { useInView } from './ui';
import { count, fmtDuration, fmtSize, W } from '../util';
import { t, type Key } from '../i18n';

const NAMES: Record<string, Key> = {
  photo: 'viewer.media.photo', live_photo: 'viewer.media.livePhoto', video: 'viewer.media.video', animation: 'viewer.media.animation',
  audio: 'viewer.media.audio', voice: 'viewer.media.voice', video_note: 'viewer.media.videoNote', document: 'viewer.media.document',
  sticker: 'viewer.media.sticker', paid_media: 'viewer.media.paidMedia', story: 'viewer.media.story', contact: 'viewer.media.contact',
  location: 'viewer.media.location', venue: 'viewer.media.venue', poll: 'viewer.media.poll', dice: 'viewer.media.dice',
  checklist: 'viewer.media.checklist', gift: 'viewer.media.gift', unique_gift: 'viewer.media.uniqueGift', game: 'viewer.media.game',
  invoice: 'viewer.media.invoice', rich_message: 'viewer.media.richMessage',
};
const FILE_TYPES = new Set(['photo', 'live_photo', 'video', 'animation', 'audio', 'voice', 'video_note', 'document']);

export const isVideo = (ty: string | null) => ty === 'video' || ty === 'animation' || ty === 'video_note';
export const isPhoto = (ty: string | null) => ty === 'photo' || ty === 'live_photo';
export const isAudio = (ty: string | null) => ty === 'voice' || ty === 'audio';

export function mediaName(e: { mediaType: string | null; mediaLabel: string | null }): string {
  if (!e.mediaType) return t('viewer.media.message');
  const key = NAMES[e.mediaType];
  return key ? t(key) : ((e.mediaLabel ?? '').replace(/^\S+\s/, '') || t('viewer.media.attachment'));
}

const stripHtml = (h: string | null) => (h ? h.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&') : null);

export const captionOf = (e: EventView) => (e.text ? null : e.caption ?? (e.mediaType ? stripHtml(e.html) : null));

export function previewOf(e: EventView): string {
  if (e.text) return e.text;
  if (!e.mediaType) return t('viewer.preview.noText');
  const name = mediaName(e);
  const cap = captionOf(e);
  if (e.mediaType === 'sticker') return cap ? t('viewer.preview.stickerCaption', { caption: cap }) : name;
  if (!FILE_TYPES.has(e.mediaType)) return cap ? t('viewer.preview.named', { name, caption: cap }) : name;
  if (cap) return cap;
  if (e.albumCount > 1) return t('viewer.preview.album', { files: count(e.albumCount, W.file) });
  return name;
}

export const durationOf = (e: EventView) => {
  const d = Number(e.mediaMeta?.duration);
  return Number.isFinite(d) && d > 0 ? d : null;
};

export function aspectOf(e: EventView): number {
  const w = Number(e.mediaMeta?.width), h = Number(e.mediaMeta?.height);
  if (w > 0 && h > 0) return Math.min(Math.max(w / h, 0.5), 2.2);
  return e.mediaType === 'video_note' ? 1 : 4 / 3;
}

export function ThumbImg({ event }: { event: EventView }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const seen = useInView(ref);
  const [src, setSrc] = useState<string | null>(() => cachedThumb(event.id));
  const [err, setErr] = useState(false);

  useEffect(() => {
    if (!seen || src || !event.hasThumb) return;
    let alive = true;
    loadThumb(event.id).then((s) => { if (alive) setSrc(s); }).catch(() => { if (alive) setErr(true); });
    return () => { alive = false; };
  }, [seen, src, event.id, event.hasThumb]);

  return (
    <div ref={ref} className="img">
      {src ? <img src={src} alt="" draggable={false} />
        : err || !event.hasThumb ? <Icon name={mediaIconName(event.mediaType)} strokeWidth={1.6} />
          : <div className="skel" />}
    </div>
  );
}

function useFullWhenSeen(e: EventView) {
  const ref = useRef<HTMLDivElement | null>(null);
  const seen = useInView(ref);
  const [src, setSrc] = useState<string | null>(() => cachedFull(e.id));
  useEffect(() => {
    if (!seen || src || !e.previewable) return;
    let alive = true;
    loadFull(e.id).then((s) => { if (alive) setSrc(s); }).catch(() => {});
    return () => { alive = false; };
  }, [seen, src, e.id, e.previewable]);
  return { ref, src };
}

export function GifVideo({ e }: { e: EventView }) {
  const { ref, src } = useFullWhenSeen(e);
  return (
    <div ref={ref} className="img">
      {src ? <video src={src} autoPlay muted loop playsInline disablePictureInPicture />
        : e.hasThumb ? <ThumbImg event={e} /> : <div className="skel" />}
    </div>
  );
}

/** Стикер картинкой (webp) или видео (webm); анимированный .tgs браузер не рисует — эмодзи. */
export function StickerView({ e, size = 128 }: { e: EventView; size?: number }) {
  const video = !!e.mediaMeta?.video;
  const { ref, src } = useFullWhenSeen(video ? e : { ...e, previewable: false });
  const emoji = captionOf(e) ?? '🙂';
  const box = { width: size, height: size };
  if (video && e.previewable) {
    return (
      <div ref={ref} className="sticker-img" style={box}>
        {src ? <video src={src} autoPlay muted loop playsInline /> : <span className="sticker-emoji">{emoji}</span>}
      </div>
    );
  }
  if (e.hasThumb) {
    return <div className="sticker-img" style={box} title={emoji}><ThumbImg event={e} /></div>;
  }
  return <div className="sticker-emoji" style={{ fontSize: size / 2 }}>{emoji}</div>;
}

export function FileTile({ e }: { e: EventView }) {
  const d = durationOf(e);
  const meta = [d && fmtDuration(d), e.fileSize ? fmtSize(e.fileSize) : null].filter(Boolean).join(' · ');
  return (
    <div className="file">
      <span className="fi" style={{ ['--c' as string]: mediaColor(e.mediaType) }}><Icon name={mediaIconName(e.mediaType)} /></span>
      <div className="grow">
        <div className="fn">{e.fileName ?? mediaName(e)}</div>
        {meta && <div className="fs tnum">{meta}</div>}
      </div>
    </div>
  );
}

export function MediaHero({ e, onOpen }: { e: EventView; onOpen: () => void }) {
  const photo = isPhoto(e.mediaType);
  const [full, setFull] = useState<string | null>(() => (photo && e.previewable ? cachedFull(e.id) : null));
  const [thumb, setThumb] = useState<string | null>(() => cachedThumb(e.id));

  useEffect(() => {
    let alive = true;
    if (e.hasThumb) loadThumb(e.id).then((s) => { if (alive) setThumb(s); }).catch(() => {});
    if (photo && e.previewable) loadFull(e.id).then((s) => { if (alive) setFull(s); }).catch(() => {});
    return () => { alive = false; };
  }, [e.id, e.hasThumb, e.previewable, photo]);

  const round = e.mediaType === 'video_note';
  const d = durationOf(e);
  if (e.mediaType === 'animation' && e.previewable) {
    return (
      <div className="media-box" style={{ aspectRatio: String(aspectOf(e)) }} onClick={onOpen} role="button" aria-label={t('viewer.openFullscreen')}>
        <GifVideo e={e} />
        <span className="dur tnum">GIF</span>
      </div>
    );
  }
  return (
    <div className={`media-box${round ? ' round' : ''}`} style={round ? undefined : { aspectRatio: String(aspectOf(e)) }} onClick={onOpen} role="button" aria-label={t('viewer.openFullscreen')}>
      {full ? <img src={full} alt="" draggable={false} />
        : thumb ? <img src={thumb} alt="" draggable={false} className={photo ? 'soft' : ''} />
          : e.hasThumb || (photo && e.previewable) ? <div className="skel" />
            : <span className="ph-ico"><Icon name={mediaIconName(e.mediaType)} strokeWidth={1.5} /></span>}
      {isVideo(e.mediaType) && <span className="play"><Icon name="play" /></span>}
      {d != null && isVideo(e.mediaType) && <span className="dur tnum">{fmtDuration(d)}</span>}
    </div>
  );
}

let playingNow: HTMLAudioElement | null = null;

const audioTitle = (e: EventView) => {
  const m = e.mediaMeta as { performer?: string | null; title?: string | null } | null;
  return [m?.performer, m?.title].filter(Boolean).join(' — ') || e.fileName || t('viewer.media.audio');
};

export function AudioPlayer({ e }: { e: EventView }) {
  const dur0 = durationOf(e) ?? 0;
  const [src, setSrc] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [err, setErr] = useState('');
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(dur0);
  const ref = useRef<HTMLAudioElement | null>(null);
  const autoplay = useRef(false);
  const triedWav = useRef(false);

  const fetchSrc = async (forceWav = false) => {
    setState('loading');
    try {
      const wav = e.mediaType === 'voice' && (forceWav || !canPlayOgg());
      if (wav) triedWav.current = true;
      const url = wav ? await loadVoiceWav(e.id) : await loadFull(e.id);
      setSrc(url); setState('ready');
    } catch (ex) { setErr(fileErrorText(ex)); setState('error'); }
  };

  useEffect(() => {
    if (src && autoplay.current) { autoplay.current = false; ref.current?.play().catch(() => {}); }
  }, [src]);
  useEffect(() => () => { if (playingNow === ref.current) playingNow = null; }, []);

  const toggle = (ev: MouseEvent) => {
    ev.stopPropagation();
    if (state === 'idle' || state === 'error') { autoplay.current = true; fetchSrc(); return; }
    const a = ref.current;
    if (state !== 'ready' || !a) return;
    if (a.paused) a.play().catch(() => {}); else a.pause();
  };
  const seek = (ev: MouseEvent<HTMLDivElement>) => {
    ev.stopPropagation();
    const a = ref.current;
    if (!a || !dur) return;
    const r = ev.currentTarget.getBoundingClientRect();
    a.currentTime = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)) * dur;
  };
  const onError = () => {
    if (e.mediaType === 'voice' && !triedWav.current) { autoplay.current = true; fetchSrc(true); return; }
    setErr(t('viewer.audio.playFailed')); setState('error');
  };

  const pct = dur ? Math.min(100, (pos / dur) * 100) : 0;
  return (
    <div className="player" onClick={(ev) => ev.stopPropagation()}>
      <button className="pb" onClick={toggle} aria-label={playing ? t('viewer.audio.pause') : t('viewer.audio.play')}>
        {state === 'loading' ? <span className="spin" /> : <Icon name={playing ? 'pause' : 'play'} className={playing ? '' : 'p'} />}
      </button>
      <div className="tr">
        {e.mediaType === 'audio' && <div className="pt ellipsis">{audioTitle(e)}</div>}
        <div className="bar" onClick={seek} role="slider" aria-label={t('viewer.audio.seek')} aria-valuemin={0} aria-valuemax={Math.round(dur)} aria-valuenow={Math.round(pos)}><i style={{ width: `${pct}%` }} /></div>
        <div className="tm tnum">
          {state === 'error'
            ? <span className="red ellipsis" title={err}>{err}</span>
            : <span>{playing || pos ? `${fmtDuration(pos)} / ${fmtDuration(dur)}` : fmtDuration(dur) || (e.mediaType === 'voice' ? t('viewer.media.voice') : '')}</span>}
          {state !== 'error' && e.fileSize ? <span>{fmtSize(e.fileSize)}</span> : null}
        </div>
      </div>
      {src && (
        <audio ref={ref} src={src} preload="metadata"
          onPlay={(ev) => { if (playingNow && playingNow !== ev.currentTarget) playingNow.pause(); playingNow = ev.currentTarget; setPlaying(true); }}
          onPause={() => setPlaying(false)}
          onEnded={() => { setPlaying(false); setPos(0); }}
          onTimeUpdate={(ev) => setPos(ev.currentTarget.currentTime)}
          onLoadedMetadata={(ev) => { const d = ev.currentTarget.duration; if (Number.isFinite(d) && d > 0) setDur(d); }}
          onError={onError} />
      )}
    </div>
  );
}
