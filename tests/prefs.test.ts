import { describe, it, expect, beforeEach } from "vitest";
import { useFreshDb, bizMessage } from "./helpers.js";
import { apiMock } from "../sdk-shim/api.js";
import { onNewMessage, onDelete, onConnection } from "../tgcloud/lib/events.js";
import { notifyDeleted, notifyKeyword, notifyRename } from "../tgcloud/lib/events.js";
import { updateSettings, ensureSettings } from "../tgcloud/lib/repo/state.js";
import { inQuietHours, mirrorAllowed } from "../tgcloud/lib/view.js";
import { findByKey } from "../tgcloud/lib/repo/messages.js";
import settingsEp from "../tgcloud/endpoints/settings.js";
import action from "../tgcloud/endpoints/action.js";

const OWNER = 999;
const ctx = () => ({ initData: { user: { id: OWNER } } });
const msg = (over: Record<string, any> = {}) => bizMessage({ chat: { id: 555, type: "private", first_name: "Иван" }, from: { id: 555, first_name: "Иван", username: "ivan" }, ...over });

function quietNow() {
  const d = new Date();
  const hm = (m: number) => `${String(Math.floor(((m % 1440) + 1440) % 1440 / 60)).padStart(2, "0")}:${String(((m % 60) + 60) % 60).padStart(2, "0")}`;
  const m = d.getUTCHours() * 60 + d.getUTCMinutes();
  return { from: hm(m - 60), to: hm(m + 60) };
}

describe("prefs: чистые правила", () => {
  it("тихие часы через полночь", () => {
    const at = (h: number) => new Date(Date.UTC(2026, 9, 26, h, 30));
    expect(inQuietHours({ from: "23:00", to: "08:00" }, "UTC", at(2))).toBe(true);
    expect(inQuietHours({ from: "23:00", to: "08:00" }, "UTC", at(12))).toBe(false);
    expect(inQuietHours({ from: "13:00", to: "15:00" }, "UTC", at(14))).toBe(true);
    expect(inQuietHours(null, "UTC", at(2))).toBe(false);
  });

  it("политика копирования: типы и лимит размера", () => {
    expect(mirrorAllowed({ mirrorTypes: ["photo"] }, "video", 10)).toBe(false);
    expect(mirrorAllowed({ mirrorTypes: ["photo"] }, "live_photo", 10)).toBe(true);
    expect(mirrorAllowed({ mirrorMaxMb: 20 }, "video", 30 * 1024 * 1024)).toBe(false);
    expect(mirrorAllowed({}, "sticker", 1)).toBe(false);
  });
});

describe("prefs: поведение бота", () => {
  useFreshDb();
  beforeEach(async () => {
    await onConnection({ id: "bc1", user_chat_id: OWNER, is_enabled: true, rights: { can_reply: true } });
  });

  it("исключённый чат не сохраняется и не шлёт удалений", async () => {
    await onNewMessage(msg({ message_id: 1, text: "до исключения" }), "bc1");
    expect((await action({ type: "exclude", chatId: 555, value: true }, ctx())).excluded).toBe(true);
    expect(await onNewMessage(msg({ message_id: 2, text: "после" }), "bc1")).toBeNull();
    expect(await findByKey("bc1", 555, 2)).toBeNull();
    expect(await onDelete({ chat: { id: 555 }, message_ids: [1] }, "bc1")).toBeNull();
  });

  it("в группу копируются только выбранные типы", async () => {
    await updateSettings(OWNER, { mirrorTypes: ["photo"] });
    const v = await onNewMessage(msg({ message_id: 1, text: undefined, video: { file_id: "v", file_unique_id: "uv", duration: 3 } }), "bc1");
    const p = await onNewMessage(msg({ message_id: 2, text: undefined, photo: [{ file_id: "p", file_unique_id: "up", width: 10, height: 10 }] }), "bc1");
    expect(v?.saved.mirrorStatus).toBe("none");
    expect(p?.saved.mirrorStatus).toBe("pending");
  });

  it("смена имени: по умолчанию выключена, после включения — уведомление", async () => {
    await onNewMessage(msg({ message_id: 1, text: "раз" }), "bc1");
    const off = await onNewMessage(msg({ message_id: 3, text: "три", from: { id: 555, first_name: "Иван П", username: "ivan" } }), "bc1");
    expect(off?.rename).toBeNull();
    await updateSettings(OWNER, { notifyTypes: { rename: true } });
    const res = await onNewMessage(msg({ message_id: 2, text: "два", from: { id: 555, first_name: "Ваня", username: "vanya" } }), "bc1");
    expect(res?.rename).toMatchObject({ oldName: "Иван П", newName: "Ваня", oldUsername: "ivan", newUsername: "vanya" });
    await notifyRename(OWNER, res!.rename, "UTC");
    const html = apiMock.callsOf("sendRichMessage")[0].rich_message.html;
    expect(html).toContain("сменил имя");
    expect(html).toContain("Ваня");
  });

  it("тихие часы: без звука; ключевые слова — со звуком (по умолчанию)", async () => {
    await updateSettings(OWNER, { quietHours: quietNow(), keywords: ["срочно"] });
    await onNewMessage(msg({ message_id: 1, text: "удалю" }), "bc1");
    await notifyDeleted(OWNER, await onDelete({ chat: { id: 555 }, message_ids: [1] }, "bc1"), "UTC");
    const kw = await onNewMessage(msg({ message_id: 2, text: "срочно" }), "bc1");
    await notifyKeyword(OWNER, kw!.saved, kw!.keywordHits, "UTC");
    const [del, key] = apiMock.callsOf("sendRichMessage");
    expect(del.disable_notification).toBe(true);
    expect(key.disable_notification).toBeUndefined();
  });

  it("скрытый текст: без цитаты; выключенный вид уведомлений молчит", async () => {
    await updateSettings(OWNER, { hidePreview: true });
    await onNewMessage(msg({ message_id: 1, text: "секретный текст" }), "bc1");
    await notifyDeleted(OWNER, await onDelete({ chat: { id: 555 }, message_ids: [1] }, "bc1"), "UTC");
    const html = apiMock.callsOf("sendRichMessage")[0].rich_message.html;
    expect(html).not.toContain("секретный текст");
    expect(html).toContain("скрыт");

    await updateSettings(OWNER, { notifyTypes: { deleted: false } });
    await onNewMessage(msg({ message_id: 2, text: "ещё" }), "bc1");
    await new Promise((r) => setTimeout(r, 5));
    await notifyDeleted(OWNER, await onDelete({ chat: { id: 555 }, message_ids: [2] }, "bc1"), "UTC");
    expect(apiMock.callsOf("sendRichMessage")).toHaveLength(1);
  });

  it("умные ключевые слова: целое слово и исключения", async () => {
    await updateSettings(OWNER, { keywords: ["кот"], keywordWholeWord: true, keywordExclude: ["шутка"] });
    expect((await onNewMessage(msg({ message_id: 1, text: "купил котлету" }), "bc1"))?.keywordHits).toEqual([]);
    expect((await onNewMessage(msg({ message_id: 2, text: "мой кот спит" }), "bc1"))?.keywordHits).toEqual(["кот"]);
    expect((await onNewMessage(msg({ message_id: 3, text: "кот — это шутка" }), "bc1"))?.keywordHits).toEqual([]);
  });

  it("настройки: валидация и нормализация новых полей", async () => {
    const r = await settingsEp({ quietHours: { from: "23:00", to: "7:30" }, mirrorTypes: ["photo", "video", "voice", "document"], autoLockMin: 5, notifyTypes: { edited: false } }, ctx());
    expect(r.settings.quietHours).toEqual({ from: "23:00", to: "07:30" });
    expect(r.settings.mirrorTypes).toHaveLength(4);
    expect((await ensureSettings(OWNER)).mirrorTypes).toBeNull();
    expect(r.settings.notifyTypes).toMatchObject({ edited: false, deleted: true, rename: false });
    await expect(settingsEp({ quietHours: { from: "25:00", to: "07:00" } }, ctx())).rejects.toMatchObject({ parameters: { code: "BAD_QUIET" } });
    await expect(settingsEp({ autoLockMin: 7 }, ctx())).rejects.toMatchObject({ parameters: { code: "BAD_AUTO_LOCK" } });
  });

  it("удалить всё: нужно подтверждение, архив пустеет", async () => {
    await onNewMessage(msg({ message_id: 1 }), "bc1");
    await expect(action({ type: "wipeAll" }, ctx())).rejects.toMatchObject({ parameters: { code: "CONFIRM_REQUIRED" } });
    expect((await action({ type: "wipeAll", confirm: "DELETE_ALL" }, ctx())).removed).toBe(1);
    expect(await findByKey("bc1", 555, 1)).toBeNull();
  });
});
