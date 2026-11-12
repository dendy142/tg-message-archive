import { describe, it, expect, beforeEach } from "vitest";
import { useFreshDb, bizMessage } from "./helpers.js";
import { onNewMessage, onDelete, onEdit, onConnection } from "../tgcloud/lib/events.js";
import bootstrap from "../tgcloud/endpoints/bootstrap.js";
import chats from "../tgcloud/endpoints/chats.js";
import action from "../tgcloud/endpoints/action.js";

const ctx = { initData: { user: { id: 999 } } };

describe("новые события", () => {
  useFreshDb();
  beforeEach(() => onConnection({ id: "bc1", user_chat_id: 999, is_enabled: true, rights: {} }));

  it("первый запуск: старое считается просмотренным, новое — считается и сбрасывается «seen»", async () => {
    await onNewMessage(bizMessage({ message_id: 1 }), "bc1");
    await onDelete({ chat: { id: 555 }, message_ids: [1] }, "bc1");
    expect((await bootstrap({}, ctx)).counts.unreadEvents).toBe(0);

    await new Promise((r) => setTimeout(r, 5));
    await onNewMessage(bizMessage({ message_id: 2, text: "a" }), "bc1");
    await onNewMessage(bizMessage({ message_id: 3, text: "b" }), "bc1");
    await onDelete({ chat: { id: 555 }, message_ids: [2] }, "bc1");
    await onEdit(bizMessage({ message_id: 3, text: "b2", edit_date: Math.ceil(Date.now() / 1000) + 1 }), "bc1"); // edit_date — секунды
    await onNewMessage(bizMessage({ message_id: 4, text: "просто сообщение" }), "bc1");

    const b = await bootstrap({}, ctx);
    expect(b.counts.unreadEvents).toBe(2);
    expect((await chats({}, ctx)).items[0].unread).toBe(2);

    await action({ type: "seen", upTo: Date.now() + 3000 }, ctx);
    expect((await bootstrap({}, ctx)).counts.unreadEvents).toBe(0);
  });

  it("seen не двигает отметку назад и не уходит в будущее", async () => {
    await bootstrap({}, ctx);
    const r1 = await action({ type: "seen", upTo: Date.now() + 86_400_000 }, ctx);
    expect(r1.lastSeenEventsAt).toBeLessThanOrEqual(Date.now() + 5 * 60_000);
    const r2 = await action({ type: "seen", upTo: 1000 }, ctx);
    expect(r2.lastSeenEventsAt).toBe(r1.lastSeenEventsAt);
  });
});
