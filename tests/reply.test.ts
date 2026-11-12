import { describe, it, expect, beforeEach } from "vitest";
import { useFreshDb, bizMessage } from "./helpers.js";
import { apiMock } from "../sdk-shim/api.js";
import { onNewMessage, onConnection } from "../tgcloud/lib/events.js";
import { base64ToBytes, bytesToBase64 } from "../tgcloud/lib/util.js";
import reply from "../tgcloud/endpoints/reply.js";
import chatHistory from "../tgcloud/endpoints/chatHistory.js";

const ctx = { initData: { user: { id: 999 } } };

describe("ответ собеседнику", () => {
  useFreshDb();
  let textId = 0, photoId = 0;
  beforeEach(async () => {
    await onConnection({ id: "bc1", user_chat_id: 999, is_enabled: true, rights: { can_reply: true } });
    textId = (await onNewMessage(bizMessage({ message_id: 10, text: "вопрос" }), "bc1"))!.saved.id;
    photoId = (await onNewMessage(bizMessage({ message_id: 11, text: undefined, photo: [{ file_id: "ph", file_unique_id: "u", width: 1, height: 1 }] }), "bc1"))!.saved.id;
  });

  it("base64 туда и обратно", () => {
    const b = new Uint8Array([0, 1, 2, 250, 251, 252, 253]);
    expect([...base64ToBytes(bytesToBase64(b))]).toEqual([...b]);
    expect([...base64ToBytes("data:image/png;base64,AAEC")]).toEqual([0, 1, 2]);
    expect(() => base64ToBytes("!!!")).toThrow();
  });

  it("цитата — reply_parameters на сообщение этого чата", async () => {
    await reply({ chatId: 555, text: "ответ", replyTo: textId }, ctx);
    expect(apiMock.callsOf("sendMessage")[0].reply_parameters).toEqual({ message_id: 10, allow_sending_without_reply: true });
  });

  it("файл из архива уходит по file_id с подписью", async () => {
    await reply({ chatId: 555, text: "смотри", fileEventId: photoId }, ctx);
    expect(apiMock.callsOf("sendPhoto")[0]).toMatchObject({ business_connection_id: "bc1", chat_id: 555, photo: "ph", caption: "смотри" });
  });

  it("файл с устройства: InputFile, метод по MIME, лимит 5 МБ", async () => {
    await reply({ chatId: 555, upload: { name: "a.pdf", mime: "application/pdf", base64: bytesToBase64(new Uint8Array([1, 2, 3])) } }, ctx);
    const doc = apiMock.callsOf("sendDocument")[0];
    expect(doc.document.filename).toBe("a.pdf");
    expect([...doc.document.bytes]).toEqual([1, 2, 3]);
    const big = "A".repeat(Math.ceil((5 * 1024 * 1024 + 10) * 4 / 3));
    await expect(reply({ chatId: 555, upload: { name: "b", mime: "image/jpeg", base64: big } }, ctx)).rejects.toMatchObject({ parameters: { code: "TOO_LARGE" } });
    await expect(reply({ chatId: 555 }, ctx)).rejects.toMatchObject({ parameters: { code: "EMPTY" } });
  });

  it("окно ответа: открыто после свежего входящего, закрыто через сутки", async () => {
    expect((await chatHistory({ chatId: 555 }, ctx)).replyWindowOpen).toBe(true);
    await onNewMessage(bizMessage({ message_id: 1, chat: { id: 777, type: "private", first_name: "М" }, from: { id: 777, first_name: "М" }, date: Math.floor((Date.now() - 25 * 3600_000) / 1000) }), "bc1");
    expect((await chatHistory({ chatId: 777 }, ctx)).replyWindowOpen).toBe(false);
  });
});
