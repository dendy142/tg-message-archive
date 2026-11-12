// chat_shared приходит боту отдельным апдейтом: после выбора перечитываем состояние, пока сервер не подтвердит.
import { useState } from 'react';
import { call, ApiError } from './api';
import { canRequestChat, requestChat, haptic } from './telegram';
import { useNav } from './nav';
import { t } from './i18n';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function reasonText(reason: string | null | undefined): string {
  switch (reason) {
    case 'not_forum': return t('onboarding.reason.notForum');
    case 'not_admin': return t('onboarding.reason.notAdmin');
    case 'no_topics': return t('onboarding.reason.noTopics');
    case 'left': case 'kicked': return t('onboarding.reason.left');
    case 'restricted': return t('onboarding.reason.restricted');
    default: return t('onboarding.reason.default');
  }
}

export function useArchiveLink() {
  const nav = useNav();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const start = async (): Promise<boolean> => {
    if (!canRequestChat()) {
      setStatus(t('onboarding.link.unsupported'));
      return false;
    }
    setBusy(true); setStatus(null);
    const before = nav.boot.archive;
    try {
      const { preparedId } = await call<{ preparedId: string }>('archiveSetup');
      const sent = await requestChat(preparedId);
      if (!sent) { setStatus(t('onboarding.link.cancelled')); return false; }
      setStatus(t('onboarding.link.checking'));
      for (let i = 0; i < 12; i++) {
        await sleep(i < 4 ? 1000 : 2000);
        const b = await nav.reloadBoot().catch(() => null);
        const a = b?.archive;
        if (!a?.linked) continue;
        const changed = a.chatId !== before.chatId || a.status !== before.status || a.lostReason !== before.lostReason;
        if (a.status === 'active' && (changed || i >= 3)) {
          setStatus(null); haptic('success');
          nav.toast(t('onboarding.link.connected', { title: a.title ?? t('onboarding.step2.fallbackTitle') }), 'ok');
          return true;
        }
        if (a.status === 'lost' && changed) { setStatus(null); haptic('error'); return false; }
      }
      setStatus(t('onboarding.link.timeout'));
      return false;
    } catch (e) {
      setStatus((e as ApiError).message || t('onboarding.link.failed'));
      haptic('error');
      return false;
    } finally {
      setBusy(false);
    }
  };

  return { busy, status, start };
}
