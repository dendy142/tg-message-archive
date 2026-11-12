import { describe, it, expect, beforeEach } from "vitest";
import { useFreshDb, bizMessage, wrap } from "./helpers.js";
import { apiMock } from "../sdk-shim/api.js";
import { onNewMessage, onDelete, onConnection } from "../tgcloud/lib/events.js";
import { notifyDeleted } from "../tgcloud/lib/events.js";
import { updateSettings } from "../tgcloud/lib/repo/state.js";
import { syncCommands, RU_MENU_CODES } from "../tgcloud/lib/commands.js";
import { buildExport } from "../tgcloud/lib/export.js";
import { formatTime } from "../tgcloud/lib/text.js";
import { drainMirror } from "../tgcloud/lib/archive.js";
import { linkArchive } from "../tgcloud/lib/archive.js";
import * as msg from "../tgcloud/lib/repo/messages.js";
import event from "../tgcloud/endpoints/event.js";
import settingsEp from "../tgcloud/endpoints/settings.js";
import message from "../tgcloud/handlers/message.js";

const OWNER = 999;
const OTHER = 1000;
const ctx = (id = OWNER, extra: Record<string, any> = {}) => ({ initData: { user: { id, ...extra } } });
const chat = (id: number, name: string) => ({ chat: { id, type: "private", first_name: name }, from: { id, first_name: name } });
const say = (owner: number, text: string, extra: Record<string, any> = {}) =>
  message({ message_id: 1, chat: { id: owner, type: "private" }, from: { id: owner }, text, ...extra }, wrap("message", {}));
const lastRich = () => apiMock.callsOf("sendRichMessage").at(-1);
const lastHtml = () => lastRich()?.rich_message.html ?? "";

describe("тексты бота: язык владельца", () => {
  useFreshDb();
  beforeEach(async () => {
    await onConnection({ id: "bc1", user_chat_id: OWNER, is_enabled: true, rights: { can_reply: true } });
    await onConnection({ id: "bc2", user_chat_id: OTHER, is_enabled: true, rights: { can_reply: true } });
  });

  it("владелец с lang=en получает английское уведомление об удалении", async () => {
    await updateSettings(OWNER, { lang: "en" });
    await onNewMessage(bizMessage({ message_id: 1, text: "delete me", ...chat(555, "Ivan") }), "bc1");
    const del = await onDelete({ chat: { id: 555 }, message_ids: [1] }, "bc1");
    await notifyDeleted(OWNER, del, "UTC");
    const html = lastHtml();
    expect(html).toContain("Message deleted");
    expect(html).toContain("a copy is saved in the archive");
    expect(html).not.toContain("Удалено");
    const kb = lastRich().reply_markup.inline_keyboard;
    expect(kb[0][0].text).toBe("📂 Open in the app");
    expect(kb[2].map((b: any) => b.text)).toEqual(["↩️ Reply", "🗑 Delete from archive"]);
  });

  it("два владельца с разными языками обрабатываются одновременно без «текущего языка»", async () => {
    await updateSettings(OWNER, { lang: "en" });
    await onNewMessage(bizMessage({ message_id: 1, text: "a", ...chat(555, "Ivan") }), "bc1");
    await onNewMessage(bizMessage({ message_id: 2, text: "b", ...chat(556, "Petr"), business_connection_id: "bc2" }), "bc2");
    const d1 = await onDelete({ chat: { id: 555 }, message_ids: [1] }, "bc1");
    const d2 = await onDelete({ chat: { id: 556 }, message_ids: [2] }, "bc2");
    await Promise.all([notifyDeleted(OWNER, d1, "UTC"), notifyDeleted(OTHER, d2, "UTC")]);
    const byChat = (id: number) => apiMock.callsOf("sendRichMessage").find((c: any) => c.chat_id === id).rich_message.html;
    expect(byChat(OWNER)).toContain("Message deleted");
    expect(byChat(OTHER)).toContain("Удалено сообщение");
  });

  it("EndpointError из endpoint приходит по-английски при settings.lang=en и по-русски по умолчанию", async () => {
    await expect(event({ id: 424242 }, ctx(OTHER))).rejects.toMatchObject({ description: "Событие не найдено", parameters: { code: "NOT_FOUND" } });
    await updateSettings(OWNER, { lang: "en" });
    await expect(event({ id: 424242 }, ctx())).rejects.toMatchObject({ description: "Event not found", parameters: { code: "NOT_FOUND" } });
    await expect(settingsEp({ timezone: "Nowhere/Nope" }, ctx())).rejects.toMatchObject({ description: "Unknown time zone", parameters: { code: "BAD_TZ" } });
  });

  it("отказ до загрузки настроек (лимит частоты, нет пользователя) тоже переводится", async () => {
    await updateSettings(OWNER, { lang: "en" });
    const { default: clientError } = await import("../tgcloud/endpoints/clientError.js");
    let err: any;
    for (let i = 0; i < 7; i++) {
      try { await clientError({ message: `m${i}` }, ctx()); } catch (e) { err = e; }
    }
    expect(err?.parameters?.code).toBe("RATE_LIMITED");
    expect(err.description).toMatch(/^Too many requests — wait \d+ s$/);
    await expect(event({ id: 1 }, { initData: { user: { language_code: "en" } } })).rejects.toMatchObject({ description: "Could not identify the user", parameters: { code: "UNAUTHORIZED" } });
    await expect(event({ id: 1 }, { initData: {} })).rejects.toMatchObject({ description: "Не удалось определить пользователя" });
  });

  it("команда /export без данных: отказ показан на языке владельца", async () => {
    await updateSettings(OWNER, { lang: "en" });
    await say(OWNER, "/export 7d csv");
    expect(lastHtml()).toContain("Nothing found for the selected period");
    await say(OTHER, "/export 7d csv");
    expect(lastHtml()).toContain("За выбранный период ничего нет");
  });

  it("/help и /pause отвечают по-английски, /start берёт язык из language_code", async () => {
    await updateSettings(OWNER, { lang: "en", langSource: "manual" });
    await say(OWNER, "/help");
    expect(lastHtml()).toContain("Commands");
    expect(lastHtml()).toContain("What the bot can do");
    await say(OWNER, "/pause");
    expect(lastHtml()).toContain("Notifications are off");
    await say(OTHER, "/start", { from: { id: OTHER, language_code: "en" } });
    expect(lastHtml()).toContain("Connected");
  });

  it("setMyCommands: меню по умолчанию — английское, для ru/uk/be/kk — русское", async () => {
    expect(await syncCommands()).toBe(true);
    const calls = apiMock.callsOf("setMyCommands");
    const def = calls.filter((c: any) => c.language_code === undefined);
    expect(def).toHaveLength(1);
    expect(def[0].scope).toEqual({ type: "all_private_chats" });
    expect(def[0].commands.find((c: any) => c.command === "app").description).toBe("Open the app");
    expect(calls.map((c: any) => c.language_code).filter(Boolean).sort()).toEqual([...RU_MENU_CODES].sort());
    for (const code of ["ru", "uk", "be", "kk"]) {
      const c = calls.find((x: any) => x.language_code === code);
      expect(c.commands.find((x: any) => x.command === "app").description).toBe("Открыть приложение");
      expect(c.scope).toEqual({ type: "all_private_chats" });
    }
    apiMock.reset();
    expect(await syncCommands()).toBe(false);
    expect(apiMock.callsOf("setMyCommands")).toHaveLength(0);
  });

  it("выгрузка: заголовки CSV/Markdown/HTML и даты по языку", () => {
    const row = { id: 1, chatId: 5, chatName: "Ivan", senderName: "Ivan", isOutgoing: false, text: "hi", date: Date.UTC(2026, 0, 31, 10), isDeleted: true, deletedAt: Date.UTC(2026, 1, 1) };
    const en = buildExport("csv", [row], { tz: "UTC", title: "t", scope: "s", lang: "en" }).content;
    expect(en).toContain('"Date","Chat","Sender"');
    expect(en).toContain("incoming");
    expect(en).toContain("31/01/2026, 10:00");
    const ru = buildExport("csv", [row], { tz: "UTC", title: "t", scope: "s" }).content;
    expect(ru).toContain('"Дата","Чат","Отправитель"');
    expect(ru).toContain("31.01.2026, 10:00");
    expect(buildExport("md", [row], { tz: "UTC", title: "t", scope: "s", lang: "en" }).content).toContain("Messages: **1**");
    const html = buildExport("html", [row], { tz: "UTC", title: "t", scope: "s", lang: "en" }).content;
    expect(html).toContain('<html lang="en">');
    expect(html).toContain("Time zone: <code>UTC</code>");
  });

  it("подписи копий в группе-архиве и формат времени по языку", async () => {
    expect(formatTime(new Date(Date.UTC(2026, 9, 25, 14, 3)), "UTC", "ru")).toBe("25.10, 14:03");
    expect(formatTime(new Date(Date.UTC(2026, 9, 25, 14, 3)), "UTC", "en")).toBe("25/10, 14:03");
    await updateSettings(OWNER, { lang: "en" });
    await linkArchive({ ownerUserId: OWNER, chatId: -1001234, title: "Archive" });
    await onNewMessage(bizMessage({ message_id: 7, ...chat(555, "Ivan"), photo: [{ file_id: "p", file_unique_id: "u", width: 100, height: 100, file_size: 10 }] }), "bc1");
    await onDelete({ chat: { id: 555 }, message_ids: [7] }, "bc1");
    await drainMirror(OWNER, "UTC", new Date(Date.now() + 120_000));
    const row = await msg.findByKey("bc1", 555, 7);
    expect(row).not.toBeNull();
    const caps = [...apiMock.callsOf("sendPhoto").map((c: any) => c.caption), ...apiMock.callsOf("editMessageCaption").map((c: any) => c.caption)];
    expect(caps.some((c: string) => c?.includes("deleted"))).toBe(true);
    expect(caps.join("\n")).not.toContain("удалено");
  });
});
