import { describe, it, expect } from "vitest";
import { useFreshDb, bizMessage } from "./helpers.js";
import { apiMock } from "../sdk-shim/api.js";
import { onNewMessage, onConnection } from "../tgcloud/lib/events.js";
import { eraseOwner } from "../tgcloud/lib/jobs.js";
import "../tgcloud/lib/events.js";
import { maybeGlobalHousekeeping } from "../tgcloud/lib/runtime.js";
import { ensureSettings, updateSettings, getConnection } from "../tgcloud/lib/repo/state.js";
import { linkArchive, getArchive } from "../tgcloud/lib/archive.js";
import * as msg from "../tgcloud/lib/repo/messages.js";
import settingsEp from "../tgcloud/endpoints/settings.js";

const DAY = 86_400_000;
async function seedOwner(owner: number, conn: string, chat: number) {
  await onConnection({ id: conn, user_chat_id: owner, is_enabled: true, rights: {} });
  await onNewMessage(bizMessage({ business_connection_id: conn, message_id: 1, chat: { id: chat, type: "private", first_name: "X" }, from: { id: chat, first_name: "X" } }), conn);
  await linkArchive({ ownerUserId: owner, chatId: -100 - owner, title: "A" });
}

describe("удаление данных владельца", () => {
  useFreshDb();

  it("eraseOwner стирает всё о владельце и не трогает соседа", async () => {
    await seedOwner(111, "bcA", 70);
    await seedOwner(222, "bcB", 80);
    expect(await eraseOwner(111)).toBe(1);
    expect(await msg.findByKey("bcA", 70, 1)).toBeNull();
    expect(await getConnection("bcA")).toBeNull();
    expect(await getArchive(111)).toBeNull();
    expect(await msg.findByKey("bcB", 80, 1)).toBeTruthy();
    expect(await getArchive(222)).toBeTruthy();
  });

  it("отключение отмечается; по истечении срока архив удаляется с уведомлением, без настройки — нет", async () => {
    await seedOwner(111, "bcA", 70);
    await seedOwner(222, "bcB", 80);
    await updateSettings(111, { purgeAfterDisconnectDays: 7 });
    await onConnection({ id: "bcA", user_chat_id: 111, is_enabled: false, rights: {} });
    await onConnection({ id: "bcB", user_chat_id: 222, is_enabled: false, rights: {} });
    expect((await ensureSettings(111)).disconnectedAt).toBeInstanceOf(Date);

    await maybeGlobalHousekeeping(new Date(Date.now() + 3 * DAY));
    expect(await msg.findByKey("bcA", 70, 1)).toBeTruthy();

    await maybeGlobalHousekeeping(new Date(Date.now() + 8 * DAY));
    expect(await msg.findByKey("bcA", 70, 1)).toBeNull();
    expect(apiMock.callsOf("sendRichMessage").some((c: any) => c.chat_id === 111 && c.rich_message.html.includes("Архив удалён"))).toBe(true);
    expect(await msg.findByKey("bcB", 80, 1)).toBeTruthy();
  });

  it("повторное подключение снимает отметку; срок валидируется", async () => {
    await seedOwner(111, "bcA", 70);
    await onConnection({ id: "bcA", user_chat_id: 111, is_enabled: false, rights: {} });
    await onConnection({ id: "bcA", user_chat_id: 111, is_enabled: true, rights: {} });
    expect((await ensureSettings(111)).disconnectedAt).toBeNull();
    await expect(settingsEp({ purgeAfterDisconnectDays: 3 }, { initData: { user: { id: 111 } } })).rejects.toMatchObject({ parameters: { code: "BAD_PURGE" } });
  });
});
