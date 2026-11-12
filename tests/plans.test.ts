import { describe, it, expect, beforeEach } from "vitest";
import { useFreshDb, bizMessage, wrap } from "./helpers.js";
import { apiMock } from "../sdk-shim/api.js";
import { onNewMessage, onConnection } from "../tgcloud/lib/events.js";
import { planOf, checkPreCheckout, admitChat, FREE_LIMITS, TRIAL_DAYS } from "../tgcloud/lib/plans.js";
import admin from "../tgcloud/lib/admin.js";
import preCheckout from "../tgcloud/handlers/pre_checkout_query.js";
import messageHandler from "../tgcloud/handlers/message.js";
import subscribe from "../tgcloud/endpoints/subscribe.js";
import action from "../tgcloud/endpoints/action.js";
import settingsEp from "../tgcloud/endpoints/settings.js";
import pinEp from "../tgcloud/endpoints/pin.js";
import { sendExport } from "../tgcloud/lib/export.js";
import { chatPref } from "../tgcloud/lib/repo/state.js";

const OWNER = 999;
const DAY = 86_400_000;
const ctx = { initData: { user: { id: OWNER } } };
const enable = async (price = 50) => { await admin({ setPaySupport: "@support" }); expect((await admin({ setPrice: price })).ok).toBe(true); };
const paid = (over: Record<string, any> = {}) => ({
  currency: "XTR", total_amount: 50, invoice_payload: `pro:${OWNER}`, telegram_payment_charge_id: "ch_1",
  subscription_expiration_date: Math.floor((Date.now() + 30 * DAY) / 1000), is_recurring: true, is_first_recurring: true, ...over,
});
const payMsg = (sp: any) => ({ message_id: 1, chat: { id: OWNER, type: "private" }, from: { id: OWNER }, successful_payment: sp });
const later = (days: number) => new Date(Date.now() + days * DAY);

describe("тарифы", () => {
  useFreshDb();
  beforeEach(async () => { await onConnection({ id: "bc1", user_chat_id: OWNER, is_enabled: true, rights: {} }); });

  it("без цены — у всех Pro, лимитов нет", async () => {
    expect(await planOf(OWNER)).toMatchObject({ plan: "pro", enabled: false });
    await expect(subscribe({}, ctx)).rejects.toMatchObject({ parameters: { code: "NOT_AVAILABLE" } });
    for (let c = 1; c <= 5; c++) expect(await admitChat(OWNER, c)).toBe(true);
  });

  it("цена без контакта поддержки не включается", async () => {
    expect((await admin({ setPrice: 50 })).ok).toBe(false);
    await admin({ setPaySupport: "@support" });
    expect((await admin({ setPrice: 0 })).ok).toBe(false);
    expect(await admin({ setPrice: 50 })).toMatchObject({ ok: true, priceStars: 50 });
  });

  it("включение даёт пробные 14 дней, потом Free", async () => {
    await enable();
    const p = await planOf(OWNER);
    expect(p).toMatchObject({ plan: "pro", status: "trial", enabled: true });
    expect(p.expiresAt! - Date.now()).toBeGreaterThan((TRIAL_DAYS - 1) * DAY);
    expect(await planOf(OWNER, later(TRIAL_DAYS + 1))).toMatchObject({ plan: "free", status: "expired" });
  });

  it("счёт: XTR и период 30 дней; pre_checkout принимает только свой счёт с актуальной ценой", async () => {
    await enable();
    apiMock.on("createInvoiceLink", () => "https://t.me/$inv");
    expect(await subscribe({}, ctx)).toEqual({ url: "https://t.me/$inv", priceStars: 50 });
    expect(apiMock.callsOf("createInvoiceLink")[0]).toMatchObject({ currency: "XTR", subscription_period: 2_592_000, prices: [{ amount: 50 }], payload: `pro:${OWNER}` });
    const q = { id: "q1", from: { id: OWNER }, currency: "XTR", total_amount: 50, invoice_payload: `pro:${OWNER}` };
    expect((await checkPreCheckout(q)).ok).toBe(true);
    expect((await checkPreCheckout({ ...q, total_amount: 10 })).ok).toBe(false);
    expect((await checkPreCheckout({ ...q, invoice_payload: "pro:1" })).ok).toBe(false);
    await preCheckout({ ...q, total_amount: 10 }, wrap("pre_checkout_query", q));
    expect(apiMock.callsOf("answerPreCheckoutQuery")[0]).toMatchObject({ pre_checkout_query_id: "q1", ok: false });
  });

  it("successful_payment: Pro до даты продления, ответ в чат", async () => {
    await enable();
    await planOf(OWNER);
    const exp = Math.floor((Date.now() + 30 * DAY) / 1000);
    expect(await messageHandler(payMsg(paid({ subscription_expiration_date: exp })), wrap("message", {}))).toEqual({ result: { payment: true } });
    expect(await planOf(OWNER, later(20))).toMatchObject({ plan: "pro", status: "active", expiresAt: exp * 1000, isRecurring: true });
    expect(JSON.stringify(apiMock.callsOf("sendRichMessage").at(-1))).toMatch(/Pro активен/);
  });

  it("Free: новый чат сверх лимита исключается, напоминание раз в сутки; оплата возвращает чат", async () => {
    await enable();
    await planOf(OWNER);
    const free = later(TRIAL_DAYS + 1);
    for (let c = 1; c <= FREE_LIMITS.chats; c++) {
      await onNewMessage(bizMessage({ chat: { id: 1000 + c, type: "private", first_name: `C${c}` }, from: { id: 1000 + c, first_name: `C${c}` } }), "bc1");
    }
    apiMock.reset();
    expect(await admitChat(OWNER, 5000, free)).toBe(false);
    expect(await admitChat(OWNER, 5001, new Date(free.getTime() + 60_000))).toBe(false);
    expect(apiMock.callsOf("sendRichMessage")).toHaveLength(1);
    expect(await admitChat(OWNER, 1001, free)).toBe(true);
    expect(await chatPref(OWNER, 5000)).toMatchObject({ excluded: true, excludedByPlan: true });
    await messageHandler(payMsg(paid()), wrap("message", {}));
    expect(await chatPref(OWNER, 5000)).toMatchObject({ excluded: false, excludedByPlan: false });
  });

  it("Free: экспорт не в JSON, длинный срок хранения, PIN и файлы чата — отказ PLAN_LIMIT", async () => {
    await enable();
    await planOf(OWNER);
    await messageHandler(payMsg(paid()), wrap("message", {}));
    await admin({ refundStarPayment: { owner: OWNER } });
    expect(apiMock.callsOf("refundStarPayment")[0]).toMatchObject({ user_id: OWNER, telegram_payment_charge_id: "ch_1" });
    expect((await planOf(OWNER)).plan).toBe("free");
    await onNewMessage(bizMessage({}), "bc1");
    const limit = { parameters: { code: "PLAN_LIMIT" } };
    await expect(sendExport(OWNER, "UTC", { format: "html" })).rejects.toMatchObject(limit);
    await expect(settingsEp({ retentionDays: 365 }, ctx)).rejects.toMatchObject(limit);
    await expect(settingsEp({ retentionDays: null }, ctx)).rejects.toMatchObject(limit);
    expect((await settingsEp({ retentionDays: 30 }, ctx)).settings.retentionDays).toBe(30);
    await expect(pinEp({ set: true, pin: "1234" }, ctx)).rejects.toMatchObject(limit);
    await expect(action({ type: "exportMedia", chatId: 555 }, ctx)).rejects.toMatchObject(limit);
  });

  it("отмена продления: Pro до конца срока, без продления", async () => {
    await enable();
    await messageHandler(payMsg(paid()), wrap("message", {}));
    const r = await action({ type: "cancelSubscription" }, ctx);
    expect(apiMock.callsOf("editUserStarSubscription")[0]).toMatchObject({ user_id: OWNER, telegram_payment_charge_id: "ch_1", is_canceled: true });
    expect(r.plan).toMatchObject({ plan: "pro", status: "cancelled", isRecurring: false });
    await expect(action({ type: "cancelSubscription" }, ctx)).rejects.toMatchObject({ parameters: { code: "NO_SUBSCRIPTION" } });
  });

  it("/paysupport отвечает всегда", async () => {
    await messageHandler({ message_id: 2, chat: { id: OWNER, type: "private" }, from: { id: OWNER }, text: "/paysupport" }, wrap("message", {}));
    expect(JSON.stringify(apiMock.callsOf("sendRichMessage").at(-1))).toMatch(/Вопросы по оплате/);
  });
});
