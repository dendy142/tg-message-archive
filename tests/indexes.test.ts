import { describe, it, expect, beforeEach } from "vitest";
import { makeTestDb } from "../sdk-shim/testdb.js";
import * as msg from "../tgcloud/lib/repo/messages.js";

let client: any;
let seen: { sql: string; args: any[] }[] = [];

beforeEach(async () => {
  const db: any = await makeTestDb();
  client = db.$client;
  const orig = client.execute.bind(client);
  seen = [];
  client.execute = (stmt: any, args?: any) => {
    const s = typeof stmt === "string" ? { sql: stmt, args: args ?? [] } : { sql: stmt.sql, args: stmt.args ?? [] };
    if (/^\s*select/i.test(s.sql)) seen.push(s);
    return orig(stmt, args);
  };
});

async function lastPlan(): Promise<string[]> {
  const q = seen[seen.length - 1];
  const r = await client.execute({ sql: `EXPLAIN QUERY PLAN ${q.sql}`, args: q.args });
  return r.rows.map((row: any) => String(row.detail));
}
const usesIndex = (plan: string[]) => plan.filter((d) => /\b(messages|edits)\b/.test(d)).every((d) => /^SEARCH/.test(d));

describe("индексы горячих запросов", () => {
  it("dirtyMirrors — частичный индекс mirror_dirty", async () => {
    await msg.dirtyMirrors(1);
    const plan = await lastPlan();
    expect(plan.join(" | ")).toContain("messages_mirror_dirty_idx");
    expect(usesIndex(plan)).toBe(true);
  });

  it("лента правок и её счётчик — messages_owner_edited_idx", async () => {
    await msg.feed({ ownerUserId: 1, kind: "edited" });
    expect((await lastPlan()).join(" | ")).toContain("messages_owner_edited_idx");
    await msg.countFeed({ ownerUserId: 1, kind: "edited" });
    expect(usesIndex(await lastPlan())).toBe(true);
  });

  it("одноразовые и избранное — свои частичные индексы", async () => {
    await msg.feed({ ownerUserId: 1, kind: "oneTime" });
    expect((await lastPlan()).join(" | ")).toContain("messages_owner_onetime_idx");
    await msg.feed({ ownerUserId: 1, kind: "favorite" });
    expect((await lastPlan()).join(" | ")).toContain("messages_owner_fav_idx");
  });

  it("deletedSince — по чату и моменту удаления", async () => {
    await msg.deletedSince(1, 2, new Date());
    const plan = await lastPlan();
    expect(plan.join(" | ")).toContain("messages_owner_chat_deleted_idx");
  });

  it("очередь копий — частичный индекс pending", async () => {
    await msg.pendingMirrors(1);
    expect((await lastPlan()).join(" | ")).toContain("messages_mirror_pending_idx");
  });

  it("история правок сообщения — edits_owner_pk_idx", async () => {
    await msg.editsForMessage(1, 2);
    expect(usesIndex(await lastPlan())).toBe(true);
  });
});
