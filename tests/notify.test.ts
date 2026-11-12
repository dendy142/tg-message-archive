import { describe, it, expect, beforeEach } from "vitest";
import { useFreshDb, bizMessage } from "./helpers.js";
import { apiMock } from "../sdk-shim/api.js";
import { onNewMessage, onEdit, onDelete, onConnection } from "../tgcloud/lib/events.js";
import { notifyDeleted, notifyEdited, notifyKeyword } from "../tgcloud/lib/events.js";
import { updateSettings, setMeta } from "../tgcloud/lib/repo/state.js";
import { openTarget } from "../tgcloud/lib/links.js";
import admin from "../tgcloud/lib/admin.js";

const OWNER = 999;
const APP = "https://app42.tgcloud.ai";
async function connect() {
  await setMeta("app_url", APP);
  await onConnection({ id: "bc1", user_chat_id: OWNER, is_enabled: true, rights: { can_reply: true } });
}
const msg = (over = {}) => bizMessage({ chat: { id: 555, type: "private", first_name: "Иван" }, from: { id: 555, first_name: "Иван" }, ...over });

describe("notify", () => {
  useFreshDb();
  beforeEach(connect);

  it("уведомление об удалении уходит владельцу с кнопками", async () => {
    await onNewMessage(msg({ message_id: 1, text: "удалю это" }), "bc1");
    const del = await onDelete({ chat: { id: 555 }, message_ids: [1] }, "bc1");
    await notifyDeleted(OWNER, del, "UTC");
    const rich = apiMock.callsOf("sendRichMessage");
    expect(rich.length).toBe(1);
    expect(rich[0].chat_id).toBe(OWNER);
    expect(rich[0].rich_message.html).toContain("Удалено");
    const kb = rich[0].reply_markup.inline_keyboard;
    expect(kb.length).toBe(3);
    expect(kb[2].map((b: any) => b.text)).toEqual(["↩️ Ответить", "🗑 Из архива"]);
    expect(kb[2][0].web_app.url).toContain("?s=r555");
  });

  it("серия удалений склеивается: второе редактирует первое уведомление", async () => {
    await onNewMessage(msg({ message_id: 1 }), "bc1");
    await onNewMessage(msg({ message_id: 2 }), "bc1");
    const d1 = await onDelete({ chat: { id: 555 }, message_ids: [1] }, "bc1");
    await notifyDeleted(OWNER, d1, "UTC");
    const d2 = await onDelete({ chat: { id: 555 }, message_ids: [2] }, "bc1");
    await notifyDeleted(OWNER, d2, "UTC");
    expect(apiMock.callsOf("sendRichMessage").length).toBe(1);
    expect(apiMock.callsOf("editMessageText").length).toBe(1);
  });

  it("очистка чата: уведомление + архив документом", async () => {
    const ids = [1, 2, 3, 4, 5, 6];
    for (const id of ids) await onNewMessage(msg({ message_id: id, text: `m${id}` }), "bc1");
    const del = await onDelete({ chat: { id: 555 }, message_ids: ids }, "bc1");
    expect(del?.wipe).toBe(true);
    await notifyDeleted(OWNER, del, "UTC");
    const rich = apiMock.callsOf("sendRichMessage");
    expect(rich[0].rich_message.html).toContain("Очищен весь чат");
    expect(rich[0].rich_message.media?.[0]?.id).toBe("archive");
  });

  it("правка шлёт было/стало", async () => {
    await onNewMessage(msg({ message_id: 1, text: "было" }), "bc1");
    const res = await onEdit(msg({ message_id: 1, text: "стало", edit_date: Math.floor(Date.now() / 1000) }), "bc1");
    await notifyEdited(OWNER, res, "UTC");
    const rich = apiMock.callsOf("sendRichMessage");
    expect(rich[0].rich_message.html).toContain("изменено");
    expect(rich[0].rich_message.html).toContain("было");
    expect(rich[0].rich_message.html).toContain("стало");
  });

  it("тишина по чату глушит уведомления", async () => {
    const { toggleMute } = await import("../tgcloud/lib/repo/state.js");
    await toggleMute(OWNER, 555);
    await onNewMessage(msg({ message_id: 1 }), "bc1");
    const del = await onDelete({ chat: { id: 555 }, message_ids: [1] }, "bc1");
    await notifyDeleted(OWNER, del, "UTC");
    expect(apiMock.callsOf("sendRichMessage").length).toBe(0);
  });

  it("выключенные уведомления молчат", async () => {
    await updateSettings(OWNER, { notificationsEnabled: false });
    await onNewMessage(msg({ message_id: 1 }), "bc1");
    const del = await onDelete({ chat: { id: 555 }, message_ids: [1] }, "bc1");
    await notifyDeleted(OWNER, del, "UTC");
    expect(apiMock.callsOf("sendRichMessage").length).toBe(0);
  });

  it("алерт по ключевому слову", async () => {
    await updateSettings(OWNER, { keywords: ["срочно"] });
    const res = await onNewMessage(msg({ message_id: 1, text: "это СРОЧНО" }), "bc1");
    await notifyKeyword(OWNER, res!.saved, res!.keywordHits, "UTC");
    const rich = apiMock.callsOf("sendRichMessage");
    expect(rich[0].rich_message.html).toContain("Ключевое слово");
    expect(rich[0].rich_message.html).toContain("срочно");
  });
});

describe("notify: удаления без копии", () => {
  useFreshDb();
  beforeEach(connect);

  it("удалили только то, чего нет в архиве, — отдельное тихое уведомление", async () => {
    await onNewMessage(msg({ message_id: 1 }), "bc1");
    const del = await onDelete({ chat: { id: 555 }, message_ids: [50, 51] }, "bc1");
    expect(del?.missing).toEqual([50, 51]);
    await notifyDeleted(OWNER, del, "UTC");
    const sent = apiMock.callsOf("sendRichMessage")[0];
    expect(sent.rich_message.html).toContain("Удалено: 2");
    expect(sent.disable_notification).toBe(true);
  });

  it("вперемешку с архивными — строка в общем уведомлении", async () => {
    await onNewMessage(msg({ message_id: 1, text: "есть" }), "bc1");
    await notifyDeleted(OWNER, await onDelete({ chat: { id: 555 }, message_ids: [1, 77] }, "bc1"), "UTC");
    const calls = apiMock.callsOf("sendRichMessage");
    expect(calls).toHaveLength(1);
    expect(calls[0].rich_message.html).toContain("ещё 1 сообщение без копии");
  });

  it("выключено в настройках — молчит", async () => {
    await updateSettings(OWNER, { notifyTypes: { deletedUnknown: false } });
    await notifyDeleted(OWNER, await onDelete({ chat: { id: 555 }, message_ids: [90] }, "bc1"), "UTC");
    expect(apiMock.callsOf("sendRichMessage")).toHaveLength(0);
  });
});

describe("адрес Mini App инстанса", () => {
  useFreshDb();

  it("не задан — кнопка «Открыть» ведёт ссылкой startapp на бота из getMe", async () => {
    expect(await openTarget("e5")).toEqual({ url: "https://t.me/archive_test_bot?startapp=e5" });
    expect(await openTarget("")).toEqual({ url: "https://t.me/archive_test_bot?startapp" });
  });

  it("setAppUrl включает web_app-кнопки, null возвращает ссылки", async () => {
    expect(await admin({ setAppUrl: `${APP}/` })).toEqual({ ok: true, appUrl: APP });
    expect(await openTarget("c555")).toEqual({ web_app: { url: `${APP}/?s=c555` } });
    expect(await openTarget("")).toEqual({ web_app: { url: `${APP}/` } });
    expect(await admin({})).toMatchObject({ appUrl: APP });

    expect(await admin({ setAppUrl: null })).toEqual({ ok: true, appUrl: null });
    expect(await openTarget("c555")).toEqual({ url: "https://t.me/archive_test_bot?startapp=c555" });
    expect(await admin({})).toMatchObject({ appUrl: null });
  });

  it("setAppUrl принимает только адрес платформы", async () => {
    for (const bad of ["https://evil.example", "http://app42.tgcloud.ai", "https://app42.tgcloud.ai.evil.example", "https://app42.tgcloud.ai/x", 42]) {
      expect((await admin({ setAppUrl: bad })).ok, String(bad)).toBe(false);
    }
    expect(await openTarget("")).toEqual({ url: "https://t.me/archive_test_bot?startapp" });
  });

  it("setMenuButton: ставит кнопку меню на Mini App, настроенную не трогает", async () => {
    expect((await admin({ setMenuButton: true })).ok).toBe(false);
    expect(apiMock.callsOf("setChatMenuButton")).toEqual([]);

    await admin({ setAppUrl: APP });
    expect(await admin({ setMenuButton: true })).toEqual({ ok: true, menuButton: "set", url: `${APP}/`, text: "Открыть" });
    expect(apiMock.callsOf("setChatMenuButton")).toEqual([{ menu_button: { type: "web_app", text: "Открыть", web_app: { url: `${APP}/` } } }]);

    apiMock.on("getChatMenuButton", () => ({ type: "web_app", text: "Моя", web_app: { url: "https://app7.tgcloud.ai/" } }));
    expect(await admin({ setMenuButton: true })).toEqual({ ok: true, menuButton: "kept", url: "https://app7.tgcloud.ai/" });
    expect(apiMock.callsOf("setChatMenuButton").length).toBe(1);
    expect(await admin({ setMenuButton: { text: "Open", force: true } })).toMatchObject({ ok: true, menuButton: "set", text: "Open" });
    expect(apiMock.callsOf("setChatMenuButton").length).toBe(2);
  });

  it("мусор в app_url не попадает в кнопку", async () => {
    await setMeta("app_url", "https://evil.example");
    expect(await openTarget("e1")).toEqual({ url: "https://t.me/archive_test_bot?startapp=e1" });
  });
});
