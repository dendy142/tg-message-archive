// Тарифы и подписка за Stars; без app_meta.price_stars у всех Pro
import { api, db } from 'sdk';
import { and, eq, sql } from 'sdk/db';
import { subscriptions, chatPrefs, chats } from '../schema.js';
import { getMeta, setMeta, delMeta, updateSettings, ensureSettings, langOf, isSet } from './repo/state.js';
import { endpointError, t } from './i18n.js';
import { sendView } from './runtime.js';
import { openOnly } from './links.js';
import { h, p, blocks } from './text.js';

export const FREE_LIMITS = Object.freeze({ chats: 3, retentionDays: 30, exportFormats: ['json'], exportMedia: false, pin: false });
export const TRIAL_DAYS = 14;
/** Период подписки Stars — ровно 30 дней (единственный, что принимает Telegram). */
export const SUBSCRIPTION_PERIOD_S = 2_592_000;
const PAYLOAD_PREFIX = 'pro:';
const DAY = 86_400_000;

export async function priceStars() {
  const v = Number(await getMeta('price_stars'));
  return Number.isSafeInteger(v) && v > 0 ? v : null;
}
export async function setPriceStars(v) {
  if (v == null) { await delMeta('price_stars'); return null; }
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < 1 || n > 10_000) throw new Error('price_stars: целое число Stars от 1 до 10000');
  await setMeta('price_stars', String(n));
  return n;
}

const getSub = (owner) => db.select().from(subscriptions).where(eq(subscriptions.ownerUserId, owner)).get();

/**
 * @returns {Promise<{ plan: 'pro' | 'free', status: string, expiresAt: number | null, enabled: boolean, isRecurring: boolean }>}
 */
export async function planOf(owner, now = new Date()) {
  if (!(await priceStars())) return { plan: 'pro', status: 'unlimited', expiresAt: null, enabled: false, isRecurring: false };
  let sub = await getSub(owner);
  if (!sub) {
    await db.insert(subscriptions).values({ ownerUserId: owner, status: 'trial', expiresAt: new Date(now.getTime() + TRIAL_DAYS * DAY), updatedAt: now }).onConflictDoNothing();
    sub = await getSub(owner);
  }
  const exp = sub?.expiresAt ? new Date(sub.expiresAt).getTime() : 0;
  const live = exp > now.getTime() && sub?.status !== 'expired';
  return { plan: live ? 'pro' : 'free', status: live ? String(sub?.status) : 'expired', expiresAt: exp || null, enabled: true, isRecurring: !!sub?.isRecurring };
}
export const isPro = async (owner) => (await planOf(owner)).plan === 'pro';

/** @param {string} key @param {Record<string, any> | null} [params] */
const planLimit = (key, params = null) => endpointError(key, params, 'PLAN_LIMIT');

export const requirePro = {
  async retention(owner, days) {
    if (days != null && days <= FREE_LIMITS.retentionDays) return;
    if (!(await isPro(owner))) throw planLimit('err.planRetention', { days: FREE_LIMITS.retentionDays });
  },
  async exportFormat(owner, format) {
    if (FREE_LIMITS.exportFormats.includes(format)) return;
    if (!(await isPro(owner))) throw planLimit('err.planExportFormat');
  },
  async exportMedia(owner) {
    if (!(await isPro(owner))) throw planLimit('err.planExportMedia');
  },
  async pin(owner) {
    if (!(await isPro(owner))) throw planLimit('err.planPin');
  },
};

/** @param {number} owner @param {number} chatId */
export async function admitChat(owner, chatId, now = new Date()) {
  if (!(await priceStars())) return true;
  const known = await db.select({ c: chats.chatId }).from(chats).where(and(eq(chats.ownerUserId, owner), eq(chats.chatId, chatId))).get();
  if (known) return true;
  if ((await planOf(owner, now)).plan === 'pro') return true;
  const tracked = await db.$count(chats, and(eq(chats.ownerUserId, owner),
    sql`not exists (select 1 from ${chatPrefs} where ${chatPrefs.ownerUserId} = ${chats.ownerUserId} and ${chatPrefs.chatId} = ${chats.chatId} and ${isSet(chatPrefs.excluded)})`));
  if (tracked < FREE_LIMITS.chats) return true;
  await db.insert(chatPrefs).values({ ownerUserId: owner, chatId, muted: false, autoRead: false, excluded: true, excludedByPlan: true, updatedAt: now })
    .onConflictDoUpdate({ target: [chatPrefs.ownerUserId, chatPrefs.chatId], set: { excluded: true, excludedByPlan: true, updatedAt: now } });
  const s = await ensureSettings(owner);
  const last = s.planNoticeAt ? new Date(s.planNoticeAt).getTime() : 0;
  if (now.getTime() - last > DAY) {
    await updateSettings(owner, { planNoticeAt: now });
    await sendView(owner, {
      html: blocks(h(3, t(s.lang, 'plans.limit.title')), p(t(s.lang, 'plans.limit.body', { n: FREE_LIMITS.chats }))),
      reply_markup: await openOnly(s.lang),
    }).catch(() => {});
  }
  return false;
}

async function releasePlanExclusions(owner, now = new Date()) {
  await db.update(chatPrefs).set({ excluded: false, excludedByPlan: false, updatedAt: now })
    .where(and(eq(chatPrefs.ownerUserId, owner), isSet(chatPrefs.excludedByPlan)));
}

/** @param {number} owner @param {any} [lang] язык счёта (по умолчанию — владельца) */
export async function invoiceLink(owner, lang) {
  lang ??= await langOf(owner);
  const price = await priceStars();
  if (!price) throw endpointError('err.notSold', null, 'NOT_AVAILABLE');
  const url = await api.createInvoiceLink({
    title: t(lang, 'plans.invoice.title'), description: t(lang, 'plans.invoice.description'),
    payload: `${PAYLOAD_PREFIX}${owner}`, currency: 'XTR', prices: [{ label: t(lang, 'plans.invoice.label'), amount: price }],
    subscription_period: SUBSCRIPTION_PERIOD_S,
  });
  return { url, priceStars: price };
}

/** @returns {Promise<{ ok: boolean, error?: string }>} */
export async function checkPreCheckout(q) {
  const price = await priceStars();
  const ownerOk = String(q?.invoice_payload ?? '') === `${PAYLOAD_PREFIX}${q?.from?.id}`;
  const fail = async (key) => ({ ok: false, error: t(q?.from?.id != null ? await langOf(Number(q.from.id), q.from.language_code) : null, key) });
  if (!price) return fail('plans.pre.notSold');
  if (!ownerOk || q.currency !== 'XTR') return fail('plans.pre.stale');
  if (Number(q.total_amount) !== price) return fail('plans.pre.priceChanged');
  return { ok: true };
}

/** @param {number} owner @param {any} sp SuccessfulPayment */
export async function recordPayment(owner, sp, now = new Date()) {
  if (!String(sp?.invoice_payload ?? '').startsWith(PAYLOAD_PREFIX)) return null;
  const expiresAt = sp.subscription_expiration_date ? new Date(sp.subscription_expiration_date * 1000) : new Date(now.getTime() + SUBSCRIPTION_PERIOD_S * 1000);
  const row = { status: 'active', expiresAt, chargeId: sp.telegram_payment_charge_id ?? null, isRecurring: !!sp.is_recurring || !!sp.subscription_expiration_date, updatedAt: now };
  await db.insert(subscriptions).values({ ownerUserId: owner, ...row }).onConflictDoUpdate({ target: subscriptions.ownerUserId, set: row });
  await releasePlanExclusions(owner, now);
  return { expiresAt: expiresAt.getTime(), first: !!sp.is_first_recurring || !sp.is_recurring };
}

export async function cancelSubscription(owner, now = new Date()) {
  const sub = await getSub(owner);
  if (!sub?.chargeId || sub.status !== 'active') throw endpointError('err.noSubscription', null, 'NO_SUBSCRIPTION');
  await api.editUserStarSubscription({ user_id: owner, telegram_payment_charge_id: sub.chargeId, is_canceled: true });
  await db.update(subscriptions).set({ status: 'cancelled', isRecurring: false, updatedAt: now }).where(eq(subscriptions.ownerUserId, owner));
  return planOf(owner, now);
}

export async function refundPayment(owner, chargeId, now = new Date()) {
  const sub = await getSub(owner);
  const id = chargeId ?? sub?.chargeId;
  if (!id) throw new Error('refund: нет telegram_payment_charge_id');
  await api.refundStarPayment({ user_id: owner, telegram_payment_charge_id: id });
  if (sub) await db.update(subscriptions).set({ status: 'expired', expiresAt: now, isRecurring: false, updatedAt: now }).where(eq(subscriptions.ownerUserId, owner));
  return { refunded: id };
}

export async function planView(owner) {
  const p = await planOf(owner);
  if (!p.enabled) return null;
  return { ...p, priceStars: await priceStars(), limits: p.plan === 'free' ? FREE_LIMITS : null, trialDays: TRIAL_DAYS };
}

// Подписку eraseOwner не стирает: это запись об оплате (нужна для возврата Stars), и иначе
// удаление данных давало бы новый пробный период.
