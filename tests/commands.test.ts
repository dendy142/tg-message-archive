import { describe, it, expect, beforeEach } from "vitest";
import { useFreshDb, bizMessage, wrap } from "./helpers.js";
import { apiMock } from "../sdk-shim/api.js";
import { onNewMessage, onDelete, onConnection } from "../tgcloud/lib/events.js";
import { parseCommand } from "../tgcloud/lib/commands.js";
import { ensureSettings, isMuted, getConnection } from "../tgcloud/lib/repo/state.js";
import * as msg from "../tgcloud/lib/repo/messages.js";
import message from "../tgcloud/handlers/message.js";
import callbackQuery from "../tgcloud/handlers/callback_query.js";

const OWNER = 999;
const say = (text: string, extra: Record<string, any> = {}) =>
  message({ message_id: 1, chat: { id: OWNER, type: "private" }, from: { id: OWNER }, text, ...extra }, wrap("message", {}));
const lastHtml = () => apiMock.callsOf("sendRichMessage").at(-1)?.rich_message.html ?? "";

describe("команды бота", () => {
  useFreshDb();
  beforeEach(async () => {
    await onConnection({ id: "bc1", user_chat_id: OWNER, is_enabled: true, rights: {} });
    await onNewMessage(bizMessage({ message_id: 1, text: "раз" }), "bc1");
  });

  it("разбор команды с @ботом и аргументами", () => {
    expect(parseCommand("/Export@archive_bot 7D CSV")).toEqual({ name: "export", args: ["7d", "csv"] });
    expect(parseCommand("привет")).toBeNull();
  });

  it("/id отвечает числовым id написавшего и не попадает в /help", async () => {
    await say("/id");
    expect(lastHtml()).toContain(`<code>${OWNER}</code>`);
    await say("/help");
    expect(lastHtml()).not.toContain("/id");
  });

  it("/start обновляет меню команд один раз и снимает блокировку", async () => {
    await say("/start");
    await say("/start");
    expect(apiMock.callsOf("setMyCommands")).toHaveLength(5);
    expect(apiMock.callsOf("setMyCommands")[0].commands.map((c: any) => c.command)).toContain("export");
  });

  it("/pause и /resume", async () => {
    await say("/pause");
    expect((await ensureSettings(OWNER)).notificationsEnabled).toBe(false);
    await say("/resume");
    expect((await ensureSettings(OWNER)).notificationsEnabled).toBe(true);
  });

  it("/mute ответом на уведомление глушит его чат, без ответа — список чатов", async () => {
    await say("/mute", { reply_to_message: { message_id: 5, reply_markup: { inline_keyboard: [[{ text: "x", callback_data: "mute:555" }]] } } });
    expect(await isMuted(OWNER, 555)).toBe(true);
    await say("/unmute");
    const kb = apiMock.callsOf("sendRichMessage").at(-1).reply_markup.inline_keyboard;
    expect(kb[0][0].callback_data).toBe("mute:555");
  });

  it("/export 7d csv шлёт файл, /stats — сводку, неизвестная — помощь", async () => {
    await say("/export 7d csv");
    expect(apiMock.callsOf("sendDocument")[0].document.filename).toBe("archive-7d.csv");
    await onDelete({ chat: { id: 555 }, message_ids: [1] }, "bc1");
    await say("/stats today");
    expect(lastHtml()).toContain("Сегодня");
    await say("/whatever");
    expect(lastHtml()).toContain("/export");
  });

  it("/delete_me: подтверждение кнопкой стирает всё", async () => {
    await say("/delete_me");
    expect(apiMock.callsOf("sendRichMessage").at(-1).reply_markup.inline_keyboard[0][0].callback_data).toBe("erase:ok");
    await callbackQuery({ id: "q", from: { id: OWNER }, data: "erase:ok", message: { chat: { id: OWNER }, message_id: 9 } }, wrap("callback_query", {}));
    expect(await msg.findByKey("bc1", 555, 1)).toBeNull();
    expect(await getConnection("bc1")).toBeNull();
  });
});
