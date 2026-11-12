import { describe, it, expect } from "vitest";
import { useFreshDb } from "./helpers.js";
import admin, { selftest, runFromCli } from "../tgcloud/lib/admin.js";
import { capabilities, resetCapabilitiesMemo } from "../tgcloud/lib/repo/state.js";
import { getMeta, ensureSettings } from "../tgcloud/lib/repo/state.js";

describe("selftest и возможности рантайма", () => {
  useFreshDb();

  it("проходит на локальной замене sdk и сохраняет возможности", async () => {
    resetCapabilitiesMemo();
    const r = await selftest();
    expect(r.selftest).toBe("PASS");
    expect(r.checks.every((c: any) => c.ok)).toBe(true);
    expect(r.capabilities.fts5).toBe(true);
    expect(JSON.parse((await getMeta("capabilities"))!).fts5).toBe(true);
  });

  it("lib/admin: selftest и пересборки — через вход оператора", async () => {
    expect(await admin({ selftest: true })).toMatchObject({ ok: true, selftest: "PASS" });
    expect(await admin({ rebuildChats: {} })).toEqual({ ok: false, error: "owner или all" });
    await ensureSettings(42);
    expect(await admin({ rebuildChats: { all: true } })).toMatchObject({ ok: true });
    expect(await admin({ rebuildDailyStats: { all: true } })).toMatchObject({ ok: true });
    expect(await admin({ rebuildFts: { all: true } })).toMatchObject({ ok: true });
  });

  it("runFromCli пускает только tgcloud run с одноразовым ключом", async () => {
    const key = "k".repeat(48);
    expect(await runFromCli({ errors: 1 }, { adminKey: key }, key)).toMatchObject({ ok: true, errors: [] });
    await expect(runFromCli({}, {}, key)).rejects.toThrow(/только из консоли/);
    await expect(runFromCli({}, { adminKey: "x".repeat(48) }, key)).rejects.toThrow(/только из консоли/);
    await expect(runFromCli({}, { adminKey: key, initData: { user: { id: 1 } } }, key)).rejects.toThrow(/только из консоли/);
    await expect(runFromCli({}, { adminKey: "" }, "")).rejects.toThrow(/только из консоли/);
  });

  it("capabilities() берёт кеш из app_meta", async () => {
    resetCapabilitiesMemo();
    const a = await capabilities();
    resetCapabilitiesMemo();
    const b = await capabilities();
    expect(b.checkedAt).toBe(a.checkedAt);
  });
});
