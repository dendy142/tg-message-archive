import { describe, it, expect } from "vitest";
import { useFreshDb, bizMessage } from "./helpers.js";
import { onNewMessage, onConnection } from "../tgcloud/lib/events.js";
import { claimGlobal, maybeGlobalHousekeeping, maybeOwnerHousekeeping, GLOBAL_TASKS } from "../tgcloud/lib/runtime.js";
import { updateSettings, ensureSettings } from "../tgcloud/lib/repo/state.js";
import * as msg from "../tgcloud/lib/repo/messages.js";

const H = 3_600_000;

describe("housekeeping без крона", () => {
  useFreshDb();

  it("общая уборка — не чаще раза в час, один исполнитель", async () => {
    const t0 = new Date(Date.UTC(2026, 9, 26, 10));
    expect(await claimGlobal(t0)).toBe(true);
    expect(await claimGlobal(new Date(t0.getTime() + 10 * 60_000))).toBe(false);
    const later = new Date(t0.getTime() + H + 1);
    const [a, b] = await Promise.all([claimGlobal(later), claimGlobal(later)]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
  });

  it("задача общей уборки с ошибкой не мешает остальным", async () => {
    let ran = false;
    GLOBAL_TASKS.push({ name: "boom", run: async () => { throw new Error("x"); } }, { name: "ok", run: async () => { ran = true; } });
    try {
      const done = await maybeGlobalHousekeeping(new Date(Date.UTC(2030, 0, 1)));
      expect(done).toContain("ok");
      expect(done).not.toContain("boom");
      expect(ran).toBe(true);
    } finally { GLOBAL_TASKS.splice(-2, 2); }
  });

  it("срок хранения: старое удаляется, избранное и свежее — нет, повтор раньше 6 ч — пропуск", async () => {
    await onConnection({ id: "bc1", user_chat_id: 999, is_enabled: true, rights: {} });
    const now = Date.now();
    const sec = (ms: number) => Math.floor(ms / 1000); // bizMessage.date — в секундах, как у Telegram
    await onNewMessage(bizMessage({ message_id: 1, date: sec(now - 40 * 86_400_000), text: "старое" }), "bc1");
    await onNewMessage(bizMessage({ message_id: 2, date: sec(now - 40 * 86_400_000), text: "старое избранное" }), "bc1");
    await onNewMessage(bizMessage({ message_id: 3, date: sec(now), text: "свежее" }), "bc1");
    await msg.toggleFavorite(999, (await msg.findByKey("bc1", 555, 2))!.id);
    await updateSettings(999, { retentionDays: 30 });

    expect(await maybeOwnerHousekeeping(999, new Date(now))).toBe(1);
    expect(await msg.findByKey("bc1", 555, 1)).toBeNull();
    expect(await msg.findByKey("bc1", 555, 2)).toBeTruthy();
    expect(await msg.findByKey("bc1", 555, 3)).toBeTruthy();
    expect(await maybeOwnerHousekeeping(999, new Date(now + H))).toBeNull();
    expect((await ensureSettings(999)).housekeptAt).toBeInstanceOf(Date);
  });
});
