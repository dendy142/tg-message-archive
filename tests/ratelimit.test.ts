import { describe, it, expect, beforeEach } from "vitest";
import { useFreshDb, bizMessage } from "./helpers.js";
import { onNewMessage, onConnection } from "../tgcloud/lib/events.js";
import { rateLimit } from "../tgcloud/lib/runtime.js";
import exportEp from "../tgcloud/endpoints/export.js";

const ctx = { initData: { user: { id: 999 } } };

describe("ограничение частоты", () => {
  useFreshDb();
  beforeEach(async () => {
    await onConnection({ id: "bc1", user_chat_id: 999, is_enabled: true, rights: {} });
    await onNewMessage(bizMessage({ message_id: 1 }), "bc1");
  });

  it("6-й экспорт за 10 минут — RATE_LIMITED с временем ожидания; оценка не считается", async () => {
    for (let i = 0; i < 5; i++) await exportEp({ format: "json" }, ctx);
    for (let i = 0; i < 3; i++) await exportEp({ format: "json", estimate: true }, ctx);
    await expect(exportEp({ format: "json" }, ctx)).rejects.toMatchObject({ parameters: { code: "RATE_LIMITED" } });
  });

  it("окно сбрасывается, у разных пользователей — свои счётчики", async () => {
    const t = Date.now();
    for (let i = 0; i < 10; i++) await rateLimit(1, "insights", t);
    await expect(rateLimit(1, "insights", t + 1000)).rejects.toMatchObject({ parameters: { code: "RATE_LIMITED", retryAfterMs: 59_000 } });
    await rateLimit(2, "insights", t + 1000);
    await rateLimit(1, "insights", t + 61_000);
  });
});
