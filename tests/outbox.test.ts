import { describe, it, expect, beforeEach } from "vitest";
import { useFreshDb, bizMessage } from "./helpers.js";
import { apiMock, BotApiError } from "../sdk-shim/api.js";
import { onNewMessage, onDelete, onConnection } from "../tgcloud/lib/events.js";
import { notifyDeleted, drainOutbox } from "../tgcloud/lib/events.js";
import { sendView } from "../tgcloud/lib/runtime.js";
import { ensureSettings } from "../tgcloud/lib/repo/state.js";
import { outboxHead, hasOutbox } from "../tgcloud/lib/runtime.js";

const OWNER = 999;
const tooMany = (s = 30) => new BotApiError("sendRichMessage", 429, "Too Many Requests", { retry_after: s });
const MIN = 60_000;

describe("outbox уведомлений", () => {
  useFreshDb();
  beforeEach(() => onConnection({ id: "bc1", user_chat_id: OWNER, is_enabled: true, rights: {} }));

  it("429 — уведомление ждёт в очереди не меньше retry_after и доставляется потом", async () => {
    apiMock.on("sendRichMessage", () => { throw tooMany(90); });
    const t0 = Date.now();
    expect(await sendView(OWNER, { html: "<p>раз</p>" })).toBeNull();
    const head = await outboxHead(OWNER);
    expect(new Date(head!.nextAt).getTime()).toBeGreaterThanOrEqual(t0 + 90_000);

    apiMock.handlers.delete("sendRichMessage");
    expect(await drainOutbox(OWNER, 5, new Date(t0 + 30_000))).toBe(0);
    expect(await drainOutbox(OWNER, 5, new Date(t0 + 91_000))).toBe(1);
    expect(await hasOutbox(OWNER)).toBe(false);
    expect(apiMock.callsOf("sendRichMessage").at(-1).rich_message.html).toBe("<p>раз</p>");
  });

  it("порядок сохраняется: новое встаёт за очередью, доставка строго FIFO", async () => {
    apiMock.on("sendRichMessage", () => { throw tooMany(1); });
    await sendView(OWNER, { html: "<p>1</p>" });
    apiMock.handlers.delete("sendRichMessage");
    await sendView(OWNER, { html: "<p>2</p>" });
    expect(apiMock.callsOf("sendRichMessage")).toHaveLength(1);
    await drainOutbox(OWNER, 5, new Date(Date.now() + 6_000));
    expect(apiMock.callsOf("sendRichMessage").slice(1).map((c: any) => c.rich_message.html)).toEqual(["<p>1</p>", "<p>2</p>"]);
  });

  it("голова не уходит — следующие ждут; после всех попыток уведомление отбрасывается", async () => {
    apiMock.on("sendRichMessage", () => { throw new BotApiError("sendRichMessage", 502, "Bad Gateway"); });
    await sendView(OWNER, { html: "<p>a</p>" });
    let at = Date.now();
    for (let i = 0; i < 8; i++) {
      at += 200 * MIN;
      await drainOutbox(OWNER, 5, new Date(at));
    }
    expect(await hasOutbox(OWNER)).toBe(false);
  });

  it("403 — бот заблокирован: флаг в настройках, уведомления больше не шлются", async () => {
    apiMock.on("sendRichMessage", () => { throw new BotApiError("sendRichMessage", 403, "Forbidden: bot was blocked by the user"); });
    expect(await sendView(OWNER, { html: "<p>x</p>" })).toBeNull();
    expect(await hasOutbox(OWNER)).toBe(false);
    expect((await ensureSettings(OWNER)).notificationsBlocked).toBe(true);
    apiMock.handlers.delete("sendRichMessage");
    await onNewMessage(bizMessage({ message_id: 1 }), "bc1");
    await notifyDeleted(OWNER, await onDelete({ chat: { id: 555 }, message_ids: [1] }, "bc1"), "UTC");
    expect(apiMock.callsOf("sendRichMessage")).toHaveLength(1);
  });

  it("очистка чата с архивом-файлом: в очередь — рецепт, при доставке файл собирается заново", async () => {
    const ids = [1, 2, 3, 4, 5, 6];
    for (const id of ids) await onNewMessage(bizMessage({ message_id: id, text: `m${id}` }), "bc1");
    apiMock.on("sendRichMessage", () => { throw tooMany(1); });
    await notifyDeleted(OWNER, await onDelete({ chat: { id: 555 }, message_ids: ids }, "bc1"), "UTC");
    const head = await outboxHead(OWNER);
    expect((head!.payload as any).rebuild.fn).toBe("wipe");
    apiMock.handlers.delete("sendRichMessage");
    await drainOutbox(OWNER, 5, new Date(Date.now() + 6_000));
    const sent = apiMock.callsOf("sendRichMessage").at(-1);
    expect(sent.rich_message.media[0].id).toBe("archive");
  });
});
