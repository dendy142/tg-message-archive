import { useEffect, useRef, useState } from 'react';
import { call, ApiError } from '../api';
import { useNav } from '../nav';
import { haptic } from '../telegram';
import type { EventView, Cursor } from '../types';
import { Icon } from './Icon';
import { Sheet } from './Sheet';
import { ThumbImg, mediaName, previewOf } from './Media';
import { fmtDateTime, fmtSize } from '../util';
import { t } from '../i18n';

const UPLOAD_LIMIT = 5 * 1024 * 1024;
const MAX_SIDE = 1600;

type Attach = { kind: 'archive'; e: EventView } | { kind: 'upload'; name: string; mime: string; base64: string; size: number };

function readBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

async function shrinkImage(file: File): Promise<Blob> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    if (k === 1 && file.size < 1024 * 1024) return file;
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d')?.drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise<Blob>((res) => c.toBlob((b) => res(b ?? file), 'image/jpeg', 0.85));
  } catch { return file; }
}

export function Composer({ chatId, windowOpen, windowUntil, replyTo, onClearReply, onSent, autoFocus }: {
  chatId: number; windowOpen: boolean; windowUntil: number | null; autoFocus?: boolean;
  replyTo: EventView | null; onClearReply: () => void; onSent: () => void;
}) {
  const nav = useNav();
  const [text, setText] = useState('');
  const [attach, setAttach] = useState<Attach | null>(null);
  const [sending, setSending] = useState(false);
  const [picker, setPicker] = useState(false);
  const ta = useRef<HTMLTextAreaElement | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  useEffect(() => { if (replyTo || autoFocus) ta.current?.focus(); }, [replyTo, autoFocus]);

  const autosize = (el: HTMLTextAreaElement) => { el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 132)}px`; };

  const pickFile = async (f: File | undefined) => {
    if (!f) return;
    const blob = await shrinkImage(f);
    if (blob.size > UPLOAD_LIMIT) { nav.toast(t('composer.tooLarge'), 'err'); return; }
    const mime = blob === f ? f.type || 'application/octet-stream' : 'image/jpeg';
    const name = blob === f ? f.name : f.name.replace(/\.\w+$/, '') + '.jpg';
    setAttach({ kind: 'upload', name, mime, base64: await readBase64(blob), size: blob.size });
  };

  const chooseAttach = async () => {
    const v = await nav.choose({
      title: t('composer.attach.title'),
      options: [
        { value: 'device', label: t('composer.attach.device'), hint: t('composer.attach.deviceHint'), icon: 'paperclip' },
        { value: 'archive', label: t('composer.attach.archive'), hint: t('composer.attach.archiveHint'), icon: 'archive' },
      ],
    });
    if (v === 'device') fileInput.current?.click();
    if (v === 'archive') setPicker(true);
  };

  const send = async () => {
    const body = text.trim();
    if ((!body && !attach) || sending) return;
    setSending(true);
    try {
      await call('reply', {
        chatId, text: body,
        ...(replyTo ? { replyTo: replyTo.id } : {}),
        ...(attach?.kind === 'archive' ? { fileEventId: attach.e.id } : {}),
        ...(attach?.kind === 'upload' ? { upload: { name: attach.name, mime: attach.mime, base64: attach.base64 } } : {}),
      });
      setText(''); setAttach(null); onClearReply();
      if (ta.current) ta.current.style.height = '';
      haptic('success');
      nav.toast(t('composer.sent'), 'ok');
      onSent();
    } catch (e) { haptic('error'); nav.toast((e as ApiError).message, 'err'); }
    finally { setSending(false); }
  };

  if (!windowOpen) {
    return (
      <div className="composer closed">
        <Icon name="clock" />
        <span>{windowUntil ? t('composer.closedUntil', { date: fmtDateTime(windowUntil) }) : t('composer.closed')}</span>
      </div>
    );
  }

  return (
    <div className="composer">
      {(replyTo || attach) && (
        <div className="c-top">
          {replyTo && (
            <div className="c-chip">
              <Icon name="reply" />
              <div className="grow"><b>{replyTo.isOutgoing ? t('composer.you') : replyTo.senderName ?? t('ui.event.contact')}</b><span className="ellipsis">{previewOf(replyTo)}</span></div>
              <button onClick={onClearReply} aria-label={t('composer.noQuote')}><Icon name="close" /></button>
            </div>
          )}
          {attach && (
            <div className="c-chip">
              <Icon name="paperclip" />
              <div className="grow">
                <b>{attach.kind === 'archive' ? mediaName(attach.e) : attach.name}</b>
                <span>{attach.kind === 'archive' ? (attach.e.fileSize ? fmtSize(attach.e.fileSize) : t('composer.fromArchive')) : fmtSize(attach.size)}</span>
              </div>
              <button onClick={() => setAttach(null)} aria-label={t('composer.removeFile')}><Icon name="close" /></button>
            </div>
          )}
        </div>
      )}
      <button className="attach" onClick={chooseAttach} aria-label={t('composer.attachFile')}><Icon name="paperclip" /></button>
      <input ref={fileInput} type="file" hidden onChange={(e) => { pickFile(e.target.files?.[0]); e.target.value = ''; }} />
      <textarea ref={ta} rows={1} value={text} placeholder={attach ? t('composer.captionPlaceholder') : t('composer.placeholder')} maxLength={attach ? 1024 : 4096}
        onChange={(ev) => { setText(ev.target.value); autosize(ev.target); }}
        onKeyDown={(ev) => { if (ev.key === 'Enter' && !ev.shiftKey && !('ontouchstart' in window)) { ev.preventDefault(); send(); } }} />
      <button className="send" disabled={sending || (!text.trim() && !attach)} onClick={send} aria-label={t('composer.send')}>
        {sending ? <span className="spin" style={{ width: 16, height: 16, borderWidth: 2, borderTopColor: 'var(--accent-text)' }} /> : <Icon name="send" strokeWidth={2.4} />}
      </button>
      <ArchivePicker open={picker} chatId={chatId} onClose={() => setPicker(false)} onPick={(e) => { setAttach({ kind: 'archive', e }); setPicker(false); }} />
    </div>
  );
}

function ArchivePicker({ open, chatId, onClose, onPick }: { open: boolean; chatId: number; onClose: () => void; onPick: (e: EventView) => void }) {
  const [items, setItems] = useState<EventView[] | null>(null);
  useEffect(() => {
    if (!open) return;
    call<{ items: EventView[]; next: Cursor | null }>('media', { chatId, group: 'all', limit: 60 })
      .then((r) => setItems(r.items)).catch(() => setItems([]));
  }, [open, chatId]);
  return (
    <Sheet open={open} onClose={onClose} title={t('composer.picker.title')}>
      {items == null ? <div className="spin-wrap"><div className="spin" /></div>
        : !items.length ? <div className="sh-m">{t('composer.picker.empty')}</div>
          : (
            <div className="gallery">
              {items.map((e) => (
                <button key={e.id} className="cell-m" onClick={() => onPick(e)} aria-label={mediaName(e)}>
                  {e.hasThumb ? <ThumbImg event={e} /> : <span className="ph-tile"><Icon name="file" /><span>{mediaName(e)}</span></span>}
                </button>
              ))}
            </div>
          )}
    </Sheet>
  );
}
