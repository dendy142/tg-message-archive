import { describe, it, expect, beforeEach } from "vitest";
import { useFreshDb, bizMessage } from "./helpers.js";
import { onNewMessage, onEdit, onDelete, onConnection } from "../tgcloud/lib/events.js";
import { buildDaily } from "../tgcloud/lib/repo/chats.js";
import { updateSettings, ensureSettings } from "../tgcloud/lib/repo/state.js";
import { db } from "../sdk-shim/db.js";
import { dailyStats } from "../tgcloud/schema.js";
import stats from "../tgcloud/endpoints/stats.js";
import insights from "../tgcloud/endpoints/insights.js";
import settingsEp from "../tgcloud/endpoints/settings.js";

const OWNER = 999;
const ctx = { initData: { user: { id: OWNER } } };
const sec = (ms: number) => Math.floor(ms / 1000);
const z = (n: number) => Array(n).fill(0);
const snapshot = async () => (await db.select().from(dailyStats).all())
  .map(({ updatedAt: _u, ...r }: any) => ({ ...r, hoursDeleted: r.hoursDeleted ?? z(24), hoursEdited: r.hoursEdited ?? z(24), ttd: r.ttd ?? z(7), byType: r.byType ?? {} })).sort((a: any, b: any) => `${a.day}${a.chatId}`.localeCompare(`${b.day}${b.chatId}`));

describe("daily_stats", () => {
  useFreshDb();
  beforeEach(async () => {
    await onConnection({ id: "bc1", user_chat_id: OWNER, is_enabled: true, rights: {} });
    await updateSettings(OWNER, { timezone: "Asia/Tashkent" });
    expect((await buildDaily(OWNER)).built).toBe(true);
  });

  // На платформе лимит параметров запроса ниже, чем в libsql: 200 строк × 27 колонок падали «Run error».
  it("сборка с нуля на длинной истории укладывается в лимит параметров запроса", async () => {
    const now = Date.now();
    for (let d = 0; d < 45; d++) await onNewMessage(bizMessage({ message_id: 100 + d, date: sec(now - d * 86_400_000), text: `день ${d}` }), "bc1");
    const live = await snapshot();
    expect(live.length).toBeGreaterThanOrEqual(45);
    expect((await buildDaily(OWNER)).built).toBe(true);
    expect(await snapshot()).toEqual(live);
  });

  // Параллельные сборки падали на платформе «UNIQUE constraint failed: daily_stats».
  it("две сборки разом не конфликтуют: строит одна, другая уступает", async () => {
    const now = Date.now();
    for (let d = 0; d < 5; d++) await onNewMessage(bizMessage({ message_id: 200 + d, date: sec(now - d * 86_400_000), text: `д ${d}` }), "bc1");
    const live = await snapshot();
    const [a, b] = await Promise.all([buildDaily(OWNER), buildDaily(OWNER)]);
    expect([a.built, b.built].filter(Boolean)).toHaveLength(1);
    expect(await snapshot()).toEqual(live);
    expect((await buildDaily(OWNER)).built).toBe(true);
  });

  it("инкременты совпадают со сборкой с нуля", async () => {
    const now = Date.now();
    await onNewMessage(bizMessage({ message_id: 1, date: sec(now - 3 * 86_400_000), text: "раз" }), "bc1");
    await onNewMessage(bizMessage({ message_id: 2, date: sec(now - 2 * 86_400_000), text: undefined, voice: { file_id: "v", file_unique_id: "uv", duration: 7, file_size: 900 } }), "bc1");
    await onNewMessage(bizMessage({ message_id: 3, date: sec(now - 86_400_000), from: { id: OWNER, first_name: "Я" }, text: "мой" }), "bc1");
    await onNewMessage(bizMessage({ message_id: 4, date: sec(now), text: undefined, photo: [{ file_id: "p", file_unique_id: "up", width: 1, height: 1, file_size: 100 }] }), "bc1");
    await onEdit(bizMessage({ message_id: 1, date: sec(now - 3 * 86_400_000), text: "раз!", edit_date: sec(now - 3600_000) }), "bc1");
    await onEdit(bizMessage({ message_id: 1, date: sec(now - 3 * 86_400_000), text: "раз!!", edit_date: sec(now - 1800_000) }), "bc1");
    await onEdit(bizMessage({ message_id: 3, date: sec(now - 86_400_000), from: { id: OWNER, first_name: "Я" }, text: "мой!", edit_date: sec(now - 600_000) }), "bc1");
    await onDelete({ chat: { id: 555 }, message_ids: [1, 2, 3] }, "bc1");
    const live = await snapshot();
    expect(live.length).toBeGreaterThan(0);
    await buildDaily(OWNER);
    expect(await snapshot()).toEqual(live);
  });

  it("день — по поясу владельца (20:30 UTC = следующий день в Алматы)", async () => {
    const t = Date.UTC(2026, 9, 26, 20, 30);
    await onNewMessage(bizMessage({ message_id: 9, date: sec(t) }), "bc1");
    const [row] = await snapshot();
    expect(row.day).toBe("2026-10-27");
  });

  it("stats и insights за период — из дней", async () => {
    const now = Date.now();
    for (let i = 1; i <= 4; i++) await onNewMessage(bizMessage({ message_id: i, date: sec(now - i * 60_000), text: `пароль ${i}` }), "bc1");
    await onDelete({ chat: { id: 555 }, message_ids: [1, 2, 3, 4] }, "bc1");
    const s = await stats({ days: 7 }, ctx);
    expect(s.period).toMatchObject({ captured: 4, deleted: 4 });
    expect(s.topChats[0]).toMatchObject({ chatId: 555, deleted: 4 });
    const i = await insights({ days: 7 }, ctx);
    expect(i.source).toBe("daily");
    expect(i.heatmap.deleted.flat().reduce((a: number, b: number) => a + b, 0)).toBe(4);
    expect(i.ttd.total).toBe(4);
    expect(i.deletedByType.find((x: any) => x.type === "text")).toMatchObject({ total: 4, deleted: 4 });
    expect(i.words[0].word).toBe("пароль");
  });

  it("смена пояса — пересборка", async () => {
    await onNewMessage(bizMessage({ message_id: 9, date: sec(Date.UTC(2026, 9, 26, 20, 30)) }), "bc1");
    await settingsEp({ timezone: "UTC" }, ctx);
    expect((await ensureSettings(OWNER)).statsBuilt).toBe(false);
    await stats({ days: 30 }, ctx);
    expect((await ensureSettings(OWNER)).statsBuilt).toBe(true);
    expect((await snapshot())[0].day).toBe("2026-10-26");
  });
});
