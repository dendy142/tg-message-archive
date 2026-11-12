import { call, ApiError } from './api';
import { emit } from './bus';
import { clearCache } from './cache';
import { alert, confirm, haptic } from './telegram';
import type { Nav } from './nav';
import { t } from './i18n';
import { count, W } from './util';

export interface ChatDeleteInfo {
  counts: { today: number; last3d: number; all: number };
  archiveTopic?: boolean;
}

const NAME_MAX = 40;

export const chatDeleteInfo = (chatId: number) => call<ChatDeleteInfo>('action', { type: 'chatDeleteCounts', chatId });

/** @returns удалена ли переписка */
export async function deleteChatFlow(nav: Nav, chatId: number, name: string | null, info?: ChatDeleteInfo): Promise<boolean> {
  if (!info) {
    try { info = await chatDeleteInfo(chatId); } catch (e) { nav.toast((e as ApiError).message, 'err'); return false; }
  }
  const msgs = count(info.counts.all, W.msg);
  let archive = false;
  if (info.archiveTopic) {
    const v = await nav.choose({
      title: t('deleteChat.title'),
      message: t('deleteChat.message'),
      options: [
        { value: 'app', label: t('deleteChat.appOnly'), hint: t('deleteChat.appOnlyHint'), icon: 'trash', tone: 'danger' },
        { value: 'archive', label: t('deleteChat.withArchive'), hint: t('deleteChat.withArchiveHint'), icon: 'trash', tone: 'danger' },
      ],
    });
    if (!v) return false;
    archive = v === 'archive';
  }
  // Попап Telegram принимает до 256 символов — длинное имя укорачиваем.
  const short = name && name.length > NAME_MAX ? `${name.slice(0, NAME_MAX - 1)}…` : name;
  const ask = short ? t('deleteChat.confirm', { msgs, name: short }) : t('deleteChat.confirmNoName', { msgs });
  if (!(await confirm(`${ask} ${t(archive ? 'deleteChat.confirmArchive' : 'deleteChat.confirmTail')}`))) return false;
  try {
    const r = await call<{ removed: number; archive: 'deleted' | 'kept' | 'none' }>('action', { type: 'deleteChat', chatId, archive, confirm: 'DELETE_CHAT' });
    haptic('warning');
    // На устройстве не должно остаться копий: кеш ленты и списков пересоберётся.
    clearCache();
    emit({ type: 'chatDeleted', chatId });
    nav.reloadBoot().catch(() => {});
    if (r.archive === 'kept') await alert(t('deleteChat.archiveKept'));
    else nav.toast(t(r.archive === 'deleted' ? 'deleteChat.doneWithArchive' : 'deleteChat.done', { msgs: count(r.removed, W.msg) }), 'ok');
    return true;
  } catch (e) {
    nav.toast((e as ApiError).message, 'err');
    return false;
  }
}
