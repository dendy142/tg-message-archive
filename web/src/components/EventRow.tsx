import type { ReactNode } from 'react';
import type { EventView } from '../types';
import { fmtSmart } from '../util';
import { t } from '../i18n';
import { Avatar, type AvatarStatus } from './ui';
import { Icon, mediaIconName } from './Icon';
import { ThumbImg, isVideo, previewOf } from './Media';

export const statusOf = (e: EventView): AvatarStatus =>
  e.oneTime ? 'fire' : e.isDeleted ? 'del' : e.editCount > 0 ? 'edit' : e.isFavorite ? 'fav' : null;

export function highlight(text: string, words: string[]): ReactNode {
  const ws = words.map((w) => w.trim()).filter(Boolean);
  if (!ws.length) return text;
  const esc = ws.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[её]/gi, '[её]'));
  const re = new RegExp(`(${esc.join('|')})`, 'giu');
  return text.split(re).map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part));
}

export function EventRow({ e, onClick, words, fresh }: { e: EventView; onClick: () => void; words?: string[]; fresh?: boolean }) {
  const name = e.chatName ?? e.senderName ?? t('ui.event.contact');
  const text = previewOf(e);
  return (
    <button className={`cell tap av ev${fresh ? ' fresh' : ''}`} onClick={onClick}>
      <Avatar id={e.chatId} name={name} status={statusOf(e)} />
      <div className="grow">
        <div className="top">
          <span className="name">{words ? highlight(name, words) : name}</span>
          <span className="time tnum">{fmtSmart(e.eventAt ?? e.date)}</span>
        </div>
        <div className="pre">
          <div className="txt">
            {e.isOutgoing && <b>{t('ui.event.you')}</b>}
            {e.mediaType && !e.hasThumb && e.mediaType !== 'sticker' && <Icon name={mediaIconName(e.mediaType)} />}
            {words ? highlight(text, words) : text}
          </div>
          {e.hasThumb && (
            <div className="mini">
              <ThumbImg event={e} />
              {isVideo(e.mediaType) && <span className="play sm"><Icon name="play" /></span>}
            </div>
          )}
        </div>
      </div>
    </button>
  );
}
