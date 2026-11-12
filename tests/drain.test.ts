import { describe, it, expect, beforeEach } from "vitest";
import { useFreshDb, bizMessage, wrap } from "./helpers.js";
import { apiMock, BotApiError } from "../sdk-shim/api.js";
import { onNewMessage, onConnection } from "../tgcloud/lib/events.js";
import { linkArchive } from "../tgcloud/lib/archive.js";
import { drainMirror } from "../tgcloud/lib/archive.js";
import * as msg from "../tgcloud/lib/repo/messages.js";
import bootstrap from "../tgcloud/endpoints/bootstrap.js";
import action from "../tgcloud/endpoints/action.js";
import callbackQuery from "../tgcloud/handlers/callback_query.js";

const OWNER = 999;
const ctx = { initData: { user: { id: OWNER } } };
const photo = (id: string) => [{ file_id: id, file_unique_id: `u_${id}`, width: 100, height: 100 }];

describe("разбор очередей вне апдейтов", () => {
  useFreshDb();
  beforeEach(async () => {
    await onConnection({ id: "bc1", user_chat_id: OWNER, is_enabled: true, rights: {} });
    for (const i of [1, 2, 3]) await onNewMessage(bizMessage({ message_id: i, text: undefined, photo: photo(`p${i}`) }), "bc1");
    await linkArchive({ ownerUserId: OWNER, chatId: -100500, title: "Архив" });
  });

  it("bootstrap копирует накопившееся и отдаёт счётчики", async () => {
    const r = await bootstrap({}, ctx);
    expect(apiMock.callsOf("sendPhoto")).toHaveLength(3);
    expect(r.counts.pendingMirror).toBe(0);
    expect(r.counts.failedMirror).toBe(0);
  });

  it("нажатие кнопки под уведомлением тоже разбирает очередь", async () => {
    await callbackQuery({ id: "q1", from: { id: OWNER }, data: "mute:555" }, wrap("callback_query", {}));
    expect(apiMock.callsOf("sendPhoto").length).toBeGreaterThan(0);
  });

  it("очередь без ошибок разбирается сверх базового лимита, до maxLimit", async () => {
    for (const i of [4, 5, 6, 7]) await onNewMessage(bizMessage({ message_id: i, text: undefined, photo: photo(`p${i}`) }), "bc1");
    const r = await drainMirror(OWNER, "UTC", new Date(), 2, 6);
    expect(r.sent).toBe(6);
  });

  it("неудачные копии можно вернуть в очередь", async () => {
    apiMock.on("sendPhoto", () => { throw new BotApiError("sendPhoto", 400, "Bad Request: wrong file identifier"); });
    await drainMirror(OWNER, "UTC");
    expect(await msg.countFailedMirrors(OWNER)).toBe(3);
    expect((await action({ type: "retryMirror" }, ctx)).queued).toBe(3);
    expect(await msg.countPendingMirrors(OWNER)).toBe(3);
  });
});
