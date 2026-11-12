import { useState } from 'react';
import { call, ApiError } from '../api';
import { useNav } from '../nav';
import { tg, confirm, haptic } from '../telegram';
import { Cell, SectionHeader, SectionFooter } from './ui';
import { fmtFull, count, W } from '../util';
import { t, type Key } from '../i18n';

const STATUS: Record<string, Key> = { trial: 'sheets.plan.trial', active: 'sheets.plan.active', cancelled: 'sheets.plan.cancelled', expired: 'sheets.plan.expired' };

export function PlanSection() {
  const nav = useNav();
  const plan = nav.boot.plan;
  const [busy, setBusy] = useState(false);
  if (!plan?.enabled) return null;
  const pro = plan.plan === 'pro';
  const paid = plan.status === 'active' || plan.status === 'cancelled';

  const subscribe = async () => {
    if (!tg?.openInvoice) { nav.toast(t('sheets.plan.updateTg'), 'err'); return; }
    setBusy(true);
    try {
      const { url } = await call<{ url: string }>('subscribe');
      tg.openInvoice(url, (status) => {
        setBusy(false);
        if (status === 'paid') { haptic('success'); nav.toast(t('sheets.plan.activated'), 'ok'); setTimeout(() => nav.reloadBoot().catch(() => {}), 1500); }
        else if (status === 'failed') nav.toast(t('sheets.plan.failed'), 'err');
      });
    } catch (e) { setBusy(false); nav.toast((e as ApiError).message, 'err'); }
  };
  const cancel = async () => {
    if (!(await confirm(t('sheets.plan.cancelConfirm', { date: fmtFull(plan.expiresAt) })))) return;
    try {
      await call('action', { type: 'cancelSubscription' });
      nav.toast(t('sheets.plan.cancelDone'), 'ok');
      nav.reloadBoot().catch(() => {});
    } catch (e) { nav.toast((e as ApiError).message, 'err'); }
  };

  const l = plan.limits;
  return (
    <>
      <SectionHeader>{t('sheets.plan.header')}</SectionHeader>
      <div className="sec">
        <Cell icon="star" color="#ff9500" title={pro ? 'Pro' : t('sheets.plan.free')}
          sub={pro ? t('sheets.plan.proUntil', { status: STATUS[plan.status] ? t(STATUS[plan.status]) : plan.status, date: fmtFull(plan.expiresAt) }) : l ? t('sheets.plan.limits', { chats: count(l.chats, W.chat), days: l.retentionDays }) : undefined} />
        {(!pro || plan.status === 'trial' || plan.status === 'cancelled') && (
          <Cell icon="starFill" color="#ff9500" tone="accent" title={busy ? t('sheets.plan.opening') : t('sheets.plan.subscribe', { price: plan.priceStars })} onClick={busy ? undefined : subscribe} />
        )}
        {paid && plan.status === 'active' && <Cell icon="close" title={t('sheets.plan.cancel')} tone="danger" onClick={cancel} />}
      </div>
      <SectionFooter>{t('sheets.plan.footer')}</SectionFooter>
    </>
  );
}
