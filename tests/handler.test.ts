import { describe, it, expect, vi } from "vitest";
import { useFreshDb } from "./helpers.js";
import { db } from "../sdk-shim/index.js";
import { processedUpdates, errors } from "../tgcloud/schema.js";
import { updateHandler } from "../tgcloud/lib/runtime.js";
import { claimUpdate, releaseUpdate, CLAIM_TTL_MS } from "../tgcloud/lib/repo/state.js";
import { recentErrors } from "../tgcloud/lib/runtime.js";
import { eq } from "drizzle-orm";

const ctx = (updateId: number, kind = "message") => ({ update: { update_id: updateId, [kind]: {} } });
const claimed = async (id: number) => (await db.select().from(processedUpdates).where(eq(processedUpdates.updateId, id)).all()).length;

describe("updateHandler: дедуп апдейтов", () => {
  useFreshDb();

  it("первая доставка обрабатывается, результат оборачивается в { result }", async () => {
    const own = vi.fn(async () => "ok");
    const res = await updateHandler(own)({ text: "привет" }, ctx(1));
    expect(res).toEqual({ result: "ok" });
    expect(own).toHaveBeenCalledWith({ text: "привет" }, ctx(1));
    expect(await claimed(1)).toBe(1);
  });

  it("повтор update_id пропускается: { skipped: 'duplicate' }, обработчик не вызывается", async () => {
    const own = vi.fn(async () => "ok");
    const h = updateHandler(own);
    await h({}, ctx(7));
    expect(await h({}, ctx(7))).toEqual({ skipped: "duplicate" });
    expect(own).toHaveBeenCalledTimes(1);
    expect(await h({}, ctx(8))).toEqual({ result: "ok" });
    expect(own).toHaveBeenCalledTimes(2);
  });

  it("без update_id дедупа нет: отметка не пишется, повтор обрабатывается", async () => {
    const own = vi.fn(async () => 1);
    const h = updateHandler(own);
    await h({}, {});
    await h({}, undefined);
    expect(own).toHaveBeenCalledTimes(2);
    expect(await db.select().from(processedUpdates).all()).toHaveLength(0);
  });

  it("собственной обработки нет (own = null) — { result: null }", async () => {
    expect(await updateHandler(null)({}, ctx(3))).toEqual({ result: null });
  });
});

describe("updateHandler: сбой обработки", () => {
  useFreshDb();

  it("обработчик бросил — ошибка летит наружу, отметка снята, повторная доставка принимается", async () => {
    let calls = 0;
    const h = updateHandler(async () => { if (++calls === 1) throw new Error("boom"); return "второй раз ок"; });
    await expect(h({}, ctx(10))).rejects.toThrow("boom");
    expect(await claimed(10)).toBe(0);
    expect(await h({}, ctx(10))).toEqual({ result: "второй раз ок" });
    expect(calls).toBe(2);
    expect(await h({}, ctx(10))).toEqual({ skipped: "duplicate" });
  });

  it("ошибка пишется в журнал errors: место handlers/<тип апдейта>, текст, стек, владелец", async () => {
    const h = updateHandler(async () => { throw new Error("сломалось"); });
    await expect(h({ from: { id: 321 } }, ctx(11, "callback_query"))).rejects.toThrow("сломалось");
    const rows = await db.select().from(errors).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ where: "handlers/callback_query", message: "сломалось", ownerUserId: 321 });
    expect(rows[0].stack).toContain("сломалось");
    expect((await recentErrors())[0].where).toBe("handlers/callback_query");
  });

  it("владелец для журнала берётся из user_chat_id, если from нет (business_connection)", async () => {
    const h = updateHandler(async () => { throw new Error("bc fail"); });
    await expect(h({ id: "bc1", user_chat_id: 777 }, ctx(12, "business_connection"))).rejects.toThrow();
    const [row] = await recentErrors();
    expect(row).toMatchObject({ where: "handlers/business_connection", ownerUserId: 777 });
  });

  it("описание ошибки Bot API (description) попадает в message", async () => {
    const h = updateHandler(async () => { throw { description: "Bad Request: chat not found" }; });
    await expect(h({}, ctx(13))).rejects.toBeTruthy();
    expect((await recentErrors())[0].message).toBe("Bad Request: chat not found");
  });

  it("две одинаковые ошибки подряд не плодят строки журнала (дедуп report за минуту), но апдейт пробуется заново", async () => {
    let calls = 0;
    const h = updateHandler(async () => { calls++; throw new Error("same"); });
    await expect(h({}, ctx(14))).rejects.toThrow();
    await expect(h({}, ctx(14))).rejects.toThrow();
    expect(calls).toBe(2);
    expect(await recentErrors()).toHaveLength(1);
  });

  it("успешный апдейт ничего не пишет в журнал ошибок", async () => {
    await updateHandler(async () => "ok")({}, ctx(15));
    expect(await recentErrors()).toHaveLength(0);
  });
});

describe("claimUpdate / releaseUpdate", () => {
  useFreshDb();

  it("первый claim — true, второй — false; release снова открывает апдейт", async () => {
    expect(await claimUpdate(100)).toBe(true);
    expect(await claimUpdate(100)).toBe(false);
    await releaseUpdate(100);
    expect(await claimUpdate(100)).toBe(true);
  });

  it("release несуществующего апдейта безвреден", async () => {
    await expect(releaseUpdate(404)).resolves.toBeUndefined();
  });

  it("отметка живёт CLAIM_TTL_MS: до истечения — дубль, после — апдейт можно взять снова (now передаётся)", async () => {
    const t0 = new Date("2026-05-01T10:00:00Z");
    expect(await claimUpdate(200, t0)).toBe(true);
    expect(await claimUpdate(200, new Date(t0.getTime() + CLAIM_TTL_MS - 1))).toBe(false);
    expect(await claimUpdate(200, new Date(t0.getTime() + CLAIM_TTL_MS + 1))).toBe(true);
  });

  it("повторный захват просроченной отметки её обновляет: следующий claim сразу после — снова дубль", async () => {
    const t0 = new Date("2026-05-01T10:00:00Z");
    await claimUpdate(201, t0);
    const t1 = new Date(t0.getTime() + CLAIM_TTL_MS + 1000);
    expect(await claimUpdate(201, t1)).toBe(true);
    expect(await claimUpdate(201, new Date(t1.getTime() + 1000))).toBe(false);
    expect(await claimUpdate(201, new Date(t1.getTime() + CLAIM_TTL_MS + 1))).toBe(true);
    expect(await claimed(201)).toBe(1);
  });

  it("через updateHandler: зависший (не завершённый) апдейт после TTL обрабатывается снова", async () => {
    const own = vi.fn(async () => "ok");
    const h = updateHandler(own);
    await h({}, ctx(300));
    expect(await h({}, ctx(300))).toEqual({ skipped: "duplicate" });
    await db.update(processedUpdates).set({ createdAt: new Date(Date.now() - CLAIM_TTL_MS - 60_000) }).where(eq(processedUpdates.updateId, 300));
    expect(await h({}, ctx(300))).toEqual({ result: "ok" });
    expect(own).toHaveBeenCalledTimes(2);
  });
});
