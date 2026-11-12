import { describe, it, expect, beforeEach } from "vitest";
import { useFreshDb, bizMessage } from "./helpers.js";
import { onNewMessage, onEdit, onConnection } from "../tgcloud/lib/events.js";
import { resetCapabilitiesMemo } from "../tgcloud/lib/repo/state.js";
import { setMeta, ensureSettings } from "../tgcloud/lib/repo/state.js";
import * as msg from "../tgcloud/lib/repo/messages.js";

const OWNER = 999;

describe("поиск", () => {
  useFreshDb();
  beforeEach(async () => {
    resetCapabilitiesMemo();
    await onConnection({ id: "bc1", user_chat_id: OWNER, is_enabled: true, rights: {} });
    await onNewMessage(bizMessage({ message_id: 1, text: "Встретимся у фонтана, ЁЖИК" }), "bc1");
    await onNewMessage(bizMessage({ message_id: 2, text: "пароль от вайфая" }), "bc1");
  });

  it("FTS: индекс строится при первом поиске, слова — с начала, все обязательны", async () => {
    expect((await msg.search(OWNER, "фонт ежик", {})).total).toBe(1);
    expect((await ensureSettings(OWNER)).ftsBuilt).toBe(true);
    expect((await msg.search(OWNER, "фонт пароль", {})).total).toBe(0);
    expect((await msg.search(OWNER, 'кавычка"', {})).total).toBe(0);
  });

  it("FTS следит за новыми сообщениями, правками и удалением из архива", async () => {
    await msg.search(OWNER, "x", {});
    await onNewMessage(bizMessage({ message_id: 3, text: "новый адрес" }), "bc1");
    expect((await msg.search(OWNER, "адрес", {})).total).toBe(1);
    await onEdit(bizMessage({ message_id: 2, text: "логин от почты", edit_date: Math.floor(Date.now() / 1000) }), "bc1");
    expect((await msg.search(OWNER, "пароль", {})).total).toBe(0);
    expect((await msg.search(OWNER, "логин", {})).total).toBe(1);
    await msg.deleteById(OWNER, (await msg.findByKey("bc1", 555, 3))!.id);
    expect((await msg.search(OWNER, "адрес", {})).total).toBe(0);
  });

  it("без FTS5 — поиск подстрокой", async () => {
    await setMeta("capabilities", JSON.stringify({ v: 1, fts5: false, subtle: true, checkedAt: Date.now() }));
    resetCapabilitiesMemo();
    expect((await msg.search(OWNER, "онтан", {})).total).toBe(1); // середина слова — только LIKE
    expect((await ensureSettings(OWNER)).ftsBuilt).toBe(false);
  });
});
