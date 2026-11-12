import { describe, it, expect } from "vitest";
import { useFreshDb } from "./helpers.js";
import { apiMock } from "../sdk-shim/api.js";
import { db, EndpointError } from "../sdk-shim/index.js";
import { errors } from "../tgcloud/schema.js";
import { report, recentErrors, purgeOldErrors, authed } from "../tgcloud/lib/runtime.js";
import admin, { operatorStats } from "../tgcloud/lib/admin.js";
import { runCommand } from "../tgcloud/lib/commands.js";
import clientError from "../tgcloud/endpoints/clientError.js";
import operatorEp from "../tgcloud/endpoints/operator.js";

const OP = 42;
const sent = () => [...apiMock.callsOf("sendRichMessage"), ...apiMock.callsOf("sendMessage")];

describe("report()", () => {
  useFreshDb();

  it("одна запись в минуту на signature, разные места — разные записи", async () => {
    const t = new Date();
    expect(await report("drainMirror", new Error("boom"), 1, t)).toBe(true);
    expect(await report("drainMirror", new Error("boom"), 1, new Date(t.getTime() + 30_000))).toBe(false);
    expect(await report("drainOutbox", new Error("boom"), 1, t)).toBe(true);
    expect(await report("drainMirror", new Error("boom"), 1, new Date(t.getTime() + 61_000))).toBe(true);
    expect(await recentErrors()).toHaveLength(3);
  });

  it("оператору — не чаще раза в час на signature; без оператора — молча", async () => {
    const t = Date.now();
    await report("x", new Error("no operator"), null, new Date(t));
    expect(sent()).toHaveLength(0);
    await admin({ setOperator: OP });
    await report("x", new Error("e"), null, new Date(t));
    await report("x", new Error("e"), null, new Date(t + 5 * 60_000));
    expect(sent().filter((c: any) => c.chat_id === OP)).toHaveLength(1);
    await report("x", new Error("e"), null, new Date(t + 61 * 60_000));
    expect(sent().filter((c: any) => c.chat_id === OP)).toHaveLength(2);
  });

  it("сам не бросает, даже если ошибка — не Error", async () => {
    expect(await report("weird", { description: "Bad Request: x" })).toBe(true);
    expect(await report("weird2", null)).toBe(true);
    expect((await recentErrors())[0].message).toBe("null");
  });

  it("ошибки старше 14 дней убираются", async () => {
    const now = new Date();
    await report("old", new Error("o"), null, new Date(now.getTime() - 15 * 86_400_000));
    await report("new", new Error("n"), null, now);
    await purgeOldErrors(now);
    expect((await db.select().from(errors).all()).map((r: any) => r.where)).toEqual(["new"]);
  });
});

describe("оператор", () => {
  useFreshDb();
  const msg = (from: number, text: string) => ({ message_id: 1, chat: { id: from, type: "private" }, from: { id: from }, text });

  it("/admin не оператору молчит, оператору — сводка", async () => {
    await admin({ setOperator: OP });
    await runCommand(7, msg(7, "/admin"));
    expect(sent()).toHaveLength(0);
    await runCommand(OP, msg(OP, "/admin"));
    const out = sent();
    expect(out).toHaveLength(1);
    expect(out[0].chat_id).toBe(OP);
    expect(JSON.stringify(out[0])).toMatch(/Оператор/);
  });

  it("lib/admin: setOperator с ifUnset не перетирает назначенного вручную", async () => {
    expect(await admin({ setOperator: OP, ifUnset: true })).toMatchObject({ ok: true, operator: OP });
    expect(await admin({ setOperator: 777, ifUnset: true })).toMatchObject({ ok: true, operator: OP, unchanged: true });
    expect(await admin({ setOperator: 777 })).toMatchObject({ ok: true, operator: 777 });
  });

  it("lib/admin: setOperator проверяет id, eraseOwner требует confirm", async () => {
    expect((await admin({ setOperator: "abc" })).ok).toBe(false);
    expect((await admin({ eraseOwner: 5 })).ok).toBe(false);
    expect((await admin({ resetCapability: "operator_id" })).ok).toBe(false);
    const r = await admin({});
    expect(r).toMatchObject({ ok: true, stats: { owners: 0, messageRows: 0 } });
    expect((await operatorStats()).version.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("endpoint operator — только оператору; clientError пишет и ограничен", async () => {
    await admin({ setOperator: OP });
    await expect(operatorEp({}, { initData: { user: { id: 7 } } })).rejects.toMatchObject({ parameters: { code: "NOT_FOUND" } });
    for (let i = 0; i < 5; i++) await clientError({ message: `m${i}`, where: "render" }, { initData: { user: { id: 7 } } });
    await expect(clientError({ message: "m6" }, { initData: { user: { id: 7 } } })).rejects.toMatchObject({ parameters: { code: "RATE_LIMITED" } });
    const r = await operatorEp({}, { initData: { user: { id: OP } } });
    expect(r.errors).toHaveLength(5);
    expect(r.errors[0].where).toBe("client: render");
    expect(r.stats.errors24h).toBe(5);
  });

  it("сбой endpoint — в журнал; оператору — текст ошибки, остальным — как было", async () => {
    await admin({ setOperator: OP });
    const ep = authed(async () => { throw new Error('near "all": syntax error'); });
    await expect(ep({ type: "chatDeleteCounts" }, { initData: { user: { id: 7 } } })).rejects.toThrow('near "all": syntax error');
    const row = (await recentErrors(1))[0];
    expect(row).toMatchObject({ where: "endpoint:chatDeleteCounts", message: 'near "all": syntax error', ownerUserId: 7 });
    await expect(ep({}, { initData: { user: { id: OP } } }))
      .rejects.toMatchObject({ name: "EndpointError", description: 'near "all": syntax error', parameters: { code: "INTERNAL" } });
    const refuse = authed(async () => { throw new EndpointError("Нет", { code: "NO" }); });
    const before = (await recentErrors(50)).length;
    await expect(refuse({}, { initData: { user: { id: 7 } } })).rejects.toMatchObject({ parameters: { code: "NO" } });
    expect((await recentErrors(50)).length).toBe(before);
  });
});
