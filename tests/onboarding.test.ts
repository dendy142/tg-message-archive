import { describe, it, expect, beforeEach } from "vitest";
import { useFreshDb, bizMessage, wrap } from "./helpers.js";
import { apiMock, BotApiError } from "../sdk-shim/api.js";
import { onNewMessage, onConnection } from "../tgcloud/lib/events.js";
import { linkArchiveFromShare, onBotMembershipChange } from "../tgcloud/lib/archive.js";
import { checkArchiveRights } from "../tgcloud/lib/archive.js";
import { linkArchive, getArchive, saveTopic, getTopic, markArchiveLost } from "../tgcloud/lib/archive.js";
import * as msg from "../tgcloud/lib/repo/messages.js";
import myChatMember from "../tgcloud/handlers/my_chat_member.js";
import messageHandler from "../tgcloud/handlers/message.js";

const OWNER = 999;
const GROUP = -100500;
const OTHER_GROUP = -100777;
const BOT_ID = 42; // getMe в sdk-shim отвечает id = 42

const share = (chatId: number | null = GROUP, over: Record<string, any> = {}) => ({
  message_id: 1, date: 1, chat: { id: OWNER, type: "private" }, from: { id: OWNER },
  chat_shared: { request_id: 1, chat_id: chatId ?? undefined, title: "Мой архив" }, ...over,
});
const forum = () => apiMock.on("getChat", (p: any) => ({ id: p.chat_id, type: "supergroup", is_forum: true, title: "Архив" }));
const member = (m: Record<string, any>) => apiMock.on("getChatMember", (p: any) => ({ user: { id: p.user_id }, ...m }));
const botChange = (status: string, extra: Record<string, any> = {}, chatId = GROUP, userId = BOT_ID) =>
  ({ chat: { id: chatId, type: "supergroup" }, new_chat_member: { status, user: { id: userId, is_bot: true }, ...extra } });
const photo = (id: string) => [{ file_id: id, file_unique_id: `${id}_u`, width: 1280, height: 960 }];

describe("linkArchiveFromShare", () => {
  useFreshDb();
  beforeEach(async () => { await onConnection({ id: "bc1", user_chat_id: OWNER, is_enabled: true, rights: {} }); });

  it("бот — админ форума с правом тем: группа привязана, архив активен", async () => {
    forum(); member({ status: "administrator", can_manage_topics: true });
    expect(await linkArchiveFromShare(share())).toEqual({ linked: true, chatId: GROUP });
    expect(await getArchive(OWNER)).toMatchObject({ chatId: GROUP, title: "Мой архив", status: "active", lostReason: null });
    expect(apiMock.callsOf("getChatMember")[0]).toMatchObject({ chat_id: GROUP, user_id: BOT_ID });
  });

  it("владелец берётся из chat, если в сообщении нет from", async () => {
    forum(); member({ status: "administrator", can_manage_topics: true });
    expect(await linkArchiveFromShare(share(GROUP, { from: undefined }))).toEqual({ linked: true, chatId: GROUP });
    expect(await getArchive(OWNER)).toBeTruthy();
  });

  it("при подключении досылается всё накопленное до группы", async () => {
    await onNewMessage(bizMessage({ message_id: 1, text: undefined, photo: photo("p1") }), "bc1");
    expect((await msg.findByKey("bc1", 555, 1))?.mirrorStatus).toBe("pending");
    forum(); member({ status: "administrator", can_manage_topics: true });
    await linkArchiveFromShare(share());
    expect(apiMock.callsOf("sendPhoto")).toHaveLength(1);
    expect((await msg.findByKey("bc1", 555, 1))?.mirrorStatus).toBe("done");
  });

  it("бот не админ (обычный участник): { linked:false, reason:'not_admin' }, архив помечен потерянным", async () => {
    forum(); member({ status: "member" });
    expect(await linkArchiveFromShare(share())).toEqual({ linked: false, reason: "not_admin" });
    expect(await getArchive(OWNER)).toMatchObject({ chatId: GROUP, status: "lost", lostReason: "not_admin" });
  });

  it("бота в группе нет вовсе (left) — тоже not_admin", async () => {
    forum(); member({ status: "left" });
    expect((await linkArchiveFromShare(share()))).toEqual({ linked: false, reason: "not_admin" });
  });

  it("админ без права управлять темами: reason 'no_topics'", async () => {
    forum(); member({ status: "administrator", can_manage_topics: false });
    expect(await linkArchiveFromShare(share())).toEqual({ linked: false, reason: "no_topics" });
    expect((await getArchive(OWNER))?.lostReason).toBe("no_topics");
  });

  it("группа не форум или не супергруппа: reason 'not_forum', права бота даже не запрашиваются", async () => {
    apiMock.on("getChat", (p: any) => ({ id: p.chat_id, type: "supergroup", is_forum: false }));
    expect(await linkArchiveFromShare(share())).toEqual({ linked: false, reason: "not_forum" });
    apiMock.on("getChat", (p: any) => ({ id: p.chat_id, type: "group", is_forum: true }));
    expect(await linkArchiveFromShare(share())).toEqual({ linked: false, reason: "not_forum" });
    expect(apiMock.callsOf("getChatMember")).toHaveLength(0);
  });

  it("Bot API недоступен (getChat падает): reason 'unreachable', исключение наружу не летит", async () => {
    apiMock.on("getChat", () => { throw new BotApiError("getChat", 400, "Bad Request: chat not found"); });
    expect(await linkArchiveFromShare(share())).toEqual({ linked: false, reason: "unreachable" });
    expect(await getArchive(OWNER)).toMatchObject({ status: "lost", lostReason: "unreachable" });
  });

  it("то же при сбое getChatMember", async () => {
    forum();
    apiMock.on("getChatMember", () => { throw new BotApiError("getChatMember", 403, "Forbidden: bot was kicked"); });
    expect((await linkArchiveFromShare(share()))?.reason).toBe("unreachable");
  });

  it("повторная попытка в ту же группу после того, как права выданы, снова делает архив активным", async () => {
    forum(); member({ status: "member" });
    await linkArchiveFromShare(share());
    expect((await getArchive(OWNER))?.status).toBe("lost");
    member({ status: "administrator", can_manage_topics: true });
    expect(await linkArchiveFromShare(share())).toEqual({ linked: true, chatId: GROUP });
    expect(await getArchive(OWNER)).toMatchObject({ status: "active", lostReason: null });
  });

  it("новая группа взамен прежней: темы старой сбрасываются", async () => {
    await linkArchive({ ownerUserId: OWNER, chatId: OTHER_GROUP, title: "Старый" });
    await saveTopic({ ownerUserId: OWNER, chatId: 555, archiveChatId: OTHER_GROUP, threadId: 11, name: "Иван" });
    forum(); member({ status: "administrator", can_manage_topics: true });
    expect(await linkArchiveFromShare(share())).toEqual({ linked: true, chatId: GROUP });
    expect(await getTopic(OWNER, 555)).toBeNull();
    expect(await getArchive(OWNER)).toMatchObject({ chatId: GROUP, title: "Мой архив" });
  });

  it("та же группа выбрана повторно: темы остаются", async () => {
    await linkArchive({ ownerUserId: OWNER, chatId: GROUP, title: "Архив" });
    await saveTopic({ ownerUserId: OWNER, chatId: 555, archiveChatId: GROUP, threadId: 11, name: "Иван" });
    forum(); member({ status: "administrator", can_manage_topics: true });
    await linkArchiveFromShare(share());
    expect((await getTopic(OWNER, 555))?.threadId).toBe(11);
  });

  it("неудачная попытка с другой группой не трогает темы прежней, но привязка заменяется на неудачную", async () => {
    await linkArchive({ ownerUserId: OWNER, chatId: OTHER_GROUP, title: "Рабочий" });
    await saveTopic({ ownerUserId: OWNER, chatId: 555, archiveChatId: OTHER_GROUP, threadId: 11, name: "Иван" });
    forum(); member({ status: "member" });
    expect(await linkArchiveFromShare(share())).toEqual({ linked: false, reason: "not_admin" });
    expect(await getArchive(OWNER)).toMatchObject({ chatId: GROUP, status: "lost" });
    expect((await getTopic(OWNER, 555))?.archiveChatId).toBe(OTHER_GROUP);
  });

  it("сообщение без chat_shared.chat_id или без владельца — null, ничего не проверяется", async () => {
    expect(await linkArchiveFromShare(share(null))).toBeNull();
    expect(await linkArchiveFromShare({ chat_shared: { chat_id: GROUP } })).toBeNull();
    expect(await linkArchiveFromShare({ from: { id: OWNER } })).toBeNull();
    expect(apiMock.callsOf("getChat")).toHaveLength(0);
    expect(await getArchive(OWNER)).toBeNull();
  });

  it("title может отсутствовать — сохраняется null", async () => {
    forum(); member({ status: "administrator", can_manage_topics: true });
    await linkArchiveFromShare(share(GROUP, { chat_shared: { request_id: 1, chat_id: GROUP } }));
    expect((await getArchive(OWNER))?.title).toBeNull();
  });

  it("через handlers/message: chat_shared привязывает группу, ответ — в { result }", async () => {
    forum(); member({ status: "administrator", can_manage_topics: true });
    const res = await messageHandler(share(), wrap("message", share(), 9001));
    expect(res).toEqual({ result: { linked: true, chatId: GROUP } });
  });
});

describe("checkArchiveRights", () => {
  useFreshDb();

  it("все три условия выполнены — null; id бота запоминается и getMe не повторяется", async () => {
    forum(); member({ status: "administrator", can_manage_topics: true });
    expect(await checkArchiveRights(GROUP)).toBeNull();
    expect(await checkArchiveRights(GROUP)).toBeNull();
    expect(apiMock.callsOf("getMe")).toHaveLength(1);
  });
});

describe("onBotMembershipChange", () => {
  useFreshDb();
  beforeEach(async () => {
    await onConnection({ id: "bc1", user_chat_id: OWNER, is_enabled: true, rights: {} });
    await linkArchive({ ownerUserId: OWNER, chatId: GROUP, title: "Архив" });
  });

  it("бота убрали из группы (left/kicked) или ограничили (restricted): архив потерян, причина — статус", async () => {
    for (const status of ["left", "kicked", "restricted"]) {
      await linkArchive({ ownerUserId: OWNER, chatId: GROUP, title: "Архив" });
      expect(await onBotMembershipChange(botChange(status))).toEqual({ archive: "lost", status });
      expect(await getArchive(OWNER)).toMatchObject({ status: "lost", lostReason: status });
    }
  });

  it("бота понизили до обычного участника: архив потерян, reason 'no_topics'", async () => {
    expect(await onBotMembershipChange(botChange("member"))).toEqual({ archive: "lost", status: "member" });
    expect(await getArchive(OWNER)).toMatchObject({ status: "lost", lostReason: "no_topics" });
  });

  it("бота вернули админом с правом тем: архив снова активен, причина сброшена", async () => {
    await markArchiveLost(OWNER, "left");
    expect(await onBotMembershipChange(botChange("administrator", { can_manage_topics: true }))).toEqual({ archive: "active" });
    expect(await getArchive(OWNER)).toMatchObject({ status: "active", lostReason: null });
  });

  it("после возвращения досылаются файлы, накопленные, пока бота не было", async () => {
    await onNewMessage(bizMessage({ message_id: 5, text: undefined, photo: photo("late") }), "bc1");
    await onBotMembershipChange(botChange("kicked"));
    expect(apiMock.callsOf("sendPhoto")).toHaveLength(0);
    await onBotMembershipChange(botChange("administrator", { can_manage_topics: true }));
    expect(apiMock.callsOf("sendPhoto")).toHaveLength(1);
    expect((await msg.findByKey("bc1", 555, 5))?.mirrorStatus).toBe("done");
  });

  it("уже потерянный архив: админ без права тем — остаётся потерянным с причиной no_topics", async () => {
    await markArchiveLost(OWNER, "left");
    expect(await onBotMembershipChange(botChange("administrator", { can_manage_topics: false }))).toEqual({ archive: "lost", status: "administrator" });
    expect(await getArchive(OWNER)).toMatchObject({ status: "lost", lostReason: "no_topics" });
  });

  it("активный архив: бота лишили права тем, но он остался админом — архив должен стать потерянным (no_topics)", async () => {
    expect(await onBotMembershipChange(botChange("administrator", { can_manage_topics: false }))).toEqual({ archive: "lost", status: "administrator" });
    expect(await getArchive(OWNER)).toMatchObject({ status: "lost", lostReason: "no_topics" });
  });

  it("админом стал не бот, а кто-то другой: игнорируется", async () => {
    await markArchiveLost(OWNER, "left");
    expect(await onBotMembershipChange(botChange("administrator", { can_manage_topics: true }, GROUP, 12345))).toBeNull();
    expect((await getArchive(OWNER))?.status).toBe("lost");
  });

  it("чужая группа, не являющаяся архивом, и апдейт без чата — null, архив цел", async () => {
    expect(await onBotMembershipChange(botChange("kicked", {}, OTHER_GROUP))).toBeNull();
    expect(await onBotMembershipChange({ new_chat_member: { status: "kicked" } })).toBeNull();
    expect(await onBotMembershipChange(undefined)).toBeNull();
    expect((await getArchive(OWNER))?.status).toBe("active");
  });

  it("неизвестный статус (creator) — null, архив не меняется", async () => {
    expect(await onBotMembershipChange(botChange("creator"))).toBeNull();
    expect((await getArchive(OWNER))?.status).toBe("active");
  });

  it("владелец находится по группе: права поменял другой админ — всё равно помечается архив владельца", async () => {
    const upd = { ...botChange("left"), from: { id: 31337 } };
    await onBotMembershipChange(upd);
    expect((await getArchive(OWNER))?.status).toBe("lost");
  });

  it("через handlers/my_chat_member: результат обёрнут в { result }, повтор update_id — дубль", async () => {
    const ctx = { update: { update_id: 9100, my_chat_member: botChange("kicked") } };
    expect(await myChatMember(botChange("kicked"), ctx)).toEqual({ result: { archive: "lost", status: "kicked" } });
    expect(await myChatMember(botChange("kicked"), ctx)).toEqual({ skipped: "duplicate" });
  });
});
