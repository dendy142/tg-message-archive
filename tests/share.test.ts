import { describe, it, expect, beforeEach } from "vitest";
import { useFreshDb, bizMessage } from "./helpers.js";
import { apiMock } from "../sdk-shim/api.js";
import { onNewMessage, onConnection } from "../tgcloud/lib/events.js";
import prepareShare, { shareResult } from "../tgcloud/endpoints/prepareShare.js";

describe("«Переслать в чат»", () => {
  useFreshDb();
  beforeEach(() => onConnection({ id: "bc1", user_chat_id: 999, is_enabled: true, rights: {} }));

  it("файл — кешированным результатом по file_id, текст — статьёй с подписью", () => {
    const base = { id: 1, date: Date.UTC(2026, 0, 1, 10), senderName: "Иван", isOutgoing: false, isDeleted: true };
    expect(shareResult({ ...base, mediaType: "photo", fileId: "f1", caption: "смотри" }, "UTC")).toMatchObject({ type: "photo", photo_file_id: "f1", caption: "смотри\n— Иван · 01.01, 10:00 · удалено" });
    expect(shareResult({ ...base, mediaType: "voice", fileId: "v1" }, "UTC")).toMatchObject({ type: "voice", voice_file_id: "v1", title: "🎤 Голосовое" });
    const a: any = shareResult({ ...base, text: "<b>текст</b>", mediaType: null }, "UTC");
    expect(a.type).toBe("article");
    expect(a.input_message_content.message_text).toContain("&lt;b&gt;текст");
    expect(shareResult({ ...base, mediaType: "video_note", fileId: "n1" }, "UTC").type).toBe("article");
  });

  it("endpoint готовит сообщение для владельца", async () => {
    const id = (await onNewMessage(bizMessage({ message_id: 1, text: "привет" }), "bc1"))!.saved.id;
    const r = await prepareShare({ id }, { initData: { user: { id: 999 } } });
    expect(r.preparedId).toMatch(/^prep_/);
    expect(apiMock.callsOf("savePreparedInlineMessage")[0]).toMatchObject({ user_id: 999, allow_user_chats: true });
    await expect(prepareShare({ id }, { initData: { user: { id: 1 } } })).rejects.toMatchObject({ parameters: { code: "NOT_FOUND" } });
  });
});
