import { describe, it, expect, beforeEach } from "vitest";
import { useFreshDb, bizMessage } from "./helpers.js";
import { onNewMessage, onEdit, onDelete, onConnection } from "../tgcloud/lib/events.js";
import { upsertConnection, connectionFromApi, ensureSettings, updateSettings } from "../tgcloud/lib/repo/state.js";
import * as msg from "../tgcloud/lib/repo/messages.js";

async function connect(owner = 999, over: Record<string, any> = {}) {
  await onConnection({ id: "bc1", user_chat_id: owner, is_enabled: true, rights: { can_reply: true, can_read_messages: true }, ...over });
}

describe("capture: приём бизнес-сообщений", () => {
  useFreshDb();
  beforeEach(() => connect());

  it("сохраняет входящее с нормализованным поиском и флагом направления", async () => {
    const res = await onNewMessage(bizMessage({ text: "Привет, ЁЖИК" }), "bc1");
    expect(res?.saved.isOutgoing).toBe(false);
    expect(res?.saved.searchText).toContain("ежик");
    const found = await msg.search(999, "ежик", {});
    expect(found.total).toBe(1);
  });

  it("помечает исходящее (от владельца) как своё", async () => {
    const res = await onNewMessage(bizMessage({ from: { id: 999, first_name: "Я" } }), "bc1");
    expect(res?.saved.isOutgoing).toBe(true);
  });

  it("ставит файл в очередь копирования, текст — нет", async () => {
    await onNewMessage(bizMessage({ message_id: 1, text: undefined, photo: [{ file_id: "f_s", file_unique_id: "u1", width: 90, height: 90 }, { file_id: "f_m", file_unique_id: "u2", width: 320, height: 320 }, { file_id: "f_b", file_unique_id: "u3", width: 1280, height: 1280, file_size: 500 }] }), "bc1");
    await onNewMessage(bizMessage({ message_id: 2, text: "просто текст" }), "bc1");
    expect(await msg.countPendingMirrors(999)).toBe(1);
    const pend = await msg.pendingMirrors(999);
    expect(pend[0].mediaType).toBe("photo");
    expect(pend[0].fileId).toBe("f_b");
    expect(pend[0].thumbFileId).toBe("f_m");
  });

  it("определяет ключевые слова во входящем", async () => {
    await updateSettings(999, { keywords: ["деньги", "срочно"] });
    const res = await onNewMessage(bizMessage({ text: "нужны ДЕНЬГИ сегодня" }), "bc1");
    expect(res?.keywordHits).toEqual(["деньги"]);
  });

  it("не архивирует self-chat владельца", async () => {
    const res = await onNewMessage(bizMessage({ chat: { id: 999, type: "private" } }), "bc1");
    expect(res).toBeNull();
  });
});

describe("capture: правки", () => {
  useFreshDb();
  beforeEach(() => connect());

  it("пишет версию и считает правки", async () => {
    await onNewMessage(bizMessage({ message_id: 10, text: "было" }), "bc1");
    const r = await onEdit(bizMessage({ message_id: 10, text: "стало", edit_date: Math.floor(Date.now() / 1000) }), "bc1");
    expect(r?.changed).toBe(true);
    const row = await msg.findByKey("bc1", 555, 10);
    expect(row?.text).toBe("стало");
    expect(row?.editCount).toBe(1);
    const hist = await msg.editsForMessage(999, row!.id);
    expect(hist).toHaveLength(1);
    expect(hist[0].oldText).toBe("было");
    expect(hist[0].newText).toBe("стало");
  });

  it("трансляция геопозиции обновляется молча, без версии", async () => {
    await onNewMessage(bizMessage({ message_id: 11, text: undefined, location: { latitude: 1, longitude: 2, live_period: 60 } }), "bc1");
    const r = await onEdit(bizMessage({ message_id: 11, text: undefined, location: { latitude: 9, longitude: 9, live_period: 60 } }), "bc1");
    expect(r?.silent).toBe(true);
    const row = await msg.findByKey("bc1", 555, 11);
    expect(row?.editCount).toBe(0);
  });

  it("правка пришедшего до подключения сохраняется как новое", async () => {
    const r = await onEdit(bizMessage({ message_id: 12, text: "уже изменено" }), "bc1");
    expect(r?.created).toBe(true);
    expect(await msg.findByKey("bc1", 555, 12)).toBeTruthy();
  });
});

describe("capture: удаления", () => {
  useFreshDb();
  beforeEach(() => connect());

  it("помечает удалённые и возвращает только перешедшие", async () => {
    for (const id of [1, 2, 3]) await onNewMessage(bizMessage({ message_id: id }), "bc1");
    const r = await onDelete({ chat: { id: 555 }, message_ids: [1, 2, 99] }, "bc1");
    expect(r?.transitioned.map((x) => Number(x.messageId)).sort()).toEqual([1, 2]);
    const again = await onDelete({ chat: { id: 555 }, message_ids: [1] }, "bc1");
    expect(again?.transitioned).toHaveLength(0);
  });

  it("распознаёт очистку всего чата", async () => {
    const ids = [1, 2, 3, 4, 5, 6];
    for (const id of ids) await onNewMessage(bizMessage({ message_id: id }), "bc1");
    const r = await onDelete({ chat: { id: 555 }, message_ids: ids }, "bc1");
    expect(r?.wipe).toBe(true);
  });
});

describe("capture: изоляция по владельцу", () => {
  useFreshDb();

  it("разные владельцы не видят сообщения друг друга", async () => {
    await upsertConnection(connectionFromApi({ id: "bcA", user_chat_id: 111, is_enabled: true, rights: {} }));
    await upsertConnection(connectionFromApi({ id: "bcB", user_chat_id: 222, is_enabled: true, rights: {} }));
    await ensureSettings(111); await ensureSettings(222);
    await onNewMessage(bizMessage({ business_connection_id: "bcA", message_id: 1, chat: { id: 70, type: "private", first_name: "A" }, from: { id: 70, first_name: "A" }, text: "секрет А" }), "bcA");
    await onNewMessage(bizMessage({ business_connection_id: "bcB", message_id: 1, chat: { id: 80, type: "private", first_name: "B" }, from: { id: 80, first_name: "B" }, text: "секрет Б" }), "bcB");
    expect((await msg.search(111, "секрет", {})).total).toBe(1);
    expect((await msg.search(222, "секрет", {})).total).toBe(1);
    expect((await msg.feed({ ownerUserId: 111 })).rows[0].text).toBe("секрет А");
  });
});

describe("capture: отключённое подключение игнорируется", () => {
  useFreshDb();
  it("не сохраняет по выключенному подключению", async () => {
    await upsertConnection(connectionFromApi({ id: "bc1", user_chat_id: 555, is_enabled: false, rights: {} }));
    const res = await onNewMessage(bizMessage(), "bc1");
    expect(res).toBeNull();
  });
});
