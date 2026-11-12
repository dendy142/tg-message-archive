import { describe, it, expect, beforeEach } from "vitest";
import { useFreshDb, bizMessage, wrap } from "./helpers.js";
import { apiMock } from "../sdk-shim/api.js";
import { onNewMessage, onConnection } from "../tgcloud/lib/events.js";
import * as msg from "../tgcloud/lib/repo/messages.js";
import callbackQuery from "../tgcloud/handlers/callback_query.js";

const OWNER = 999;
const press = (data: string) => callbackQuery({ id: "q", from: { id: OWNER }, data, message: { chat: { id: OWNER }, message_id: 77 } }, wrap("callback_query", {}));

describe("«🗑 Из архива» под уведомлением", () => {
  useFreshDb();
  let id = 0;
  beforeEach(async () => {
    await onConnection({ id: "bc1", user_chat_id: OWNER, is_enabled: true, rights: { can_reply: true } });
    id = (await onNewMessage(bizMessage({ message_id: 1 }), "bc1"))!.saved.id;
  });

  it("первый тап — подтверждение, «Отмена» — прежние кнопки, событие на месте", async () => {
    await press(`del:${id}`);
    const kb1 = apiMock.callsOf("editMessageReplyMarkup")[0].reply_markup.inline_keyboard;
    expect(kb1[0].map((b: any) => b.callback_data)).toEqual([`del:${id}:ok`, `del:${id}:no`]);
    await press(`del:${id}:no`);
    const kb2 = apiMock.callsOf("editMessageReplyMarkup")[1].reply_markup.inline_keyboard;
    expect(kb2.flat().some((b: any) => b.callback_data === `fav:${id}`)).toBe(true);
    expect(await msg.findById(OWNER, id)).toBeTruthy();
  });

  it("«Удалить» стирает событие и убирает ссылки на него", async () => {
    await press(`del:${id}:ok`);
    expect(await msg.findById(OWNER, id)).toBeNull();
    const kb = apiMock.callsOf("editMessageReplyMarkup")[0].reply_markup.inline_keyboard;
    expect(kb.flat().map((b: any) => b.callback_data)).toEqual(["mute:555"]);
    expect(apiMock.callsOf("answerCallbackQuery").at(-1).text).toBe("Удалено из архива");
  });

  it("чужое событие не удаляется", async () => {
    await callbackQuery({ id: "q", from: { id: 1234 }, data: `del:${id}:ok`, message: { chat: { id: 1234 }, message_id: 1 } }, wrap("callback_query", {}));
    expect(await msg.findById(OWNER, id)).toBeTruthy();
  });
});
