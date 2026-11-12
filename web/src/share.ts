import { call, ApiError } from './api';
import { canShareMessage, shareMessage, copyText, haptic } from './telegram';
import type { Nav } from './nav';
import { t } from './i18n';

export async function shareEvent(nav: Nav, id: number) {
  const v = await nav.choose({
    title: t('viewer.share'),
    options: [
      ...(canShareMessage() ? [{ value: 'forward', label: t('viewer.share.forward'), hint: t('viewer.share.forwardHint'), icon: 'forward' as const }] : []),
      { value: 'link', label: t('viewer.share.copyLink'), hint: t('viewer.share.copyLinkHint'), icon: 'copy' as const },
    ],
  });
  if (v === 'link') {
    if (await copyText(`https://t.me/${nav.boot.bot.username}?startapp=e${id}`)) { haptic('success'); nav.toast(t('viewer.share.linkCopied'), 'ok'); }
  }
  if (v === 'forward') {
    try {
      const { preparedId } = await call<{ preparedId: string }>('prepareShare', { id });
      if (await shareMessage(preparedId)) { haptic('success'); nav.toast(t('viewer.share.sent'), 'ok'); }
    } catch (ex) { nav.toast((ex as ApiError).message, 'err'); }
  }
}
