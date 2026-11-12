import { describe, it, expect, beforeEach } from "vitest";
import { useFreshDb, bizMessage } from "./helpers.js";
import { apiMock } from "../sdk-shim/api.js";
import { onNewMessage, onConnection } from "../tgcloud/lib/events.js";
import { notifyOneTime } from "../tgcloud/lib/events.js";
import * as msg from "../tgcloud/lib/repo/messages.js";
import { linkArchive } from "../tgcloud/lib/archive.js";
import feed from "../tgcloud/endpoints/feed.js";

const OWNER = 999;

const oneTimePhoto = (mid: number) => ({
  message_id: mid,
  date: Math.floor(Date.now() / 1000),
  chat: { id: 555, type: "private", first_name: "Иван" },
  from: { id: 555, first_name: "Иван" },
  photo: [{ file_id: "ot_s", file_unique_id: "u1", width: 320, height: 320 }, { file_id: "ot_b", file_unique_id: "u2", width: 1280, height: 1280, file_size: 900 }],
});
const replyTo = (parent: any) => bizMessage({
  message_id: 51, text: "ок", from: { id: OWNER, first_name: "Я" },
  chat: { id: 555, type: "private", first_name: "Иван" }, reply_to_message: parent,
});

describe("одноразовые медиа (view-once через ответ)", () => {
  useFreshDb();
  beforeEach(async () => { await onConnection({ id: "bc1", user_chat_id: OWNER, is_enabled: true, rights: { can_reply: true } }); });

  it("ловит немедленно: скачивает байты и перезаливает (в личку без группы)", async () => {
    const res = await onNewMessage(replyTo(oneTimePhoto(50)), "bc1");
    expect(res?.oneTime).toBeTruthy();
    const row = await msg.findByKey("bc1", 555, 50);
    expect(row?.oneTime).toBe(true);
    expect(row?.mediaType).toBe("photo");
    expect(apiMock.callsOf("getFileContent").length).toBe(1);
    const sends = apiMock.callsOf("sendPhoto");
    expect(sends.length).toBe(1);
    expect(sends[0].chat_id).toBe(OWNER);
  });

  it("с группой-архивом перезаливает в тему и помечает mirror done", async () => {
    await linkArchive({ ownerUserId: OWNER, chatId: -100500, title: "Архив" });
    const res = await onNewMessage(replyTo(oneTimePhoto(60)), "bc1");
    expect(res?.oneTime).toBeTruthy();
    expect(apiMock.callsOf("createForumTopic").length).toBe(1);
    const sends = apiMock.callsOf("sendPhoto");
    expect(sends[0].chat_id).toBe(-100500);
    const row = await msg.findByKey("bc1", 555, 60);
    expect(row?.mirrorStatus).toBe("done");
  });

  it("не дублирует, если оригинал уже в архиве", async () => {
    await onNewMessage({ ...oneTimePhoto(50), business_connection_id: "bc1" }, "bc1");
    const res = await onNewMessage(replyTo(oneTimePhoto(50)), "bc1");
    expect(res?.oneTime).toBeNull();
  });

  it("обычный текстовый ответ ничего не ловит", async () => {
    const reply = replyTo({ message_id: 70, date: Math.floor(Date.now() / 1000), chat: { id: 555 }, from: { id: 555 }, text: "просто текст" });
    const res = await onNewMessage(reply, "bc1");
    expect(res?.oneTime).toBeNull();
  });

  it("попадает в фильтр ленты oneTime и шлёт уведомление", async () => {
    const res = await onNewMessage(replyTo(oneTimePhoto(80)), "bc1");
    await notifyOneTime(OWNER, res!.oneTime, "UTC");
    expect(apiMock.callsOf("sendRichMessage")[0].rich_message.html).toContain("Одноразовое");
    const f = await feed({ kind: "oneTime" }, { initData: { user: { id: OWNER } } });
    expect(f.items.length).toBe(1);
    expect(f.items[0].oneTime).toBe(true);
  });
});
