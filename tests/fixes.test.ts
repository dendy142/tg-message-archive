import { describe, it, expect, beforeEach } from "vitest";
import { useFreshDb, bizMessage } from "./helpers.js";
import { apiMock } from "../sdk-shim/api.js";
import { onNewMessage, onEdit, onConnection } from "../tgcloud/lib/events.js";
import { notifyEdited } from "../tgcloud/lib/events.js";
import { upsertConnection, connectionFromApi } from "../tgcloud/lib/repo/state.js";
import { linkArchive, getArchive } from "../tgcloud/lib/archive.js";
import { onBotMembershipChange } from "../tgcloud/lib/archive.js";
import action from "../tgcloud/endpoints/action.js";
import search from "../tgcloud/endpoints/search.js";

const OWNER = 999;
const ctx = { initData: { user: { id: OWNER } } };

describe("мелкие дефекты", () => {
  useFreshDb();
  beforeEach(() => onConnection({ id: "bc1", user_chat_id: OWNER, is_enabled: true, rights: { can_reply: true, can_read_messages: true } }));

  it("время «изменено» в уведомлении — момент правки, а не отправки уведомления", async () => {
    await onNewMessage(bizMessage({ message_id: 1, text: "было" }), "bc1");
    const editedAt = Math.floor(Date.UTC(2026, 0, 5, 7, 30) / 1000);
    const res = await onEdit(bizMessage({ message_id: 1, text: "стало", edit_date: editedAt }), "bc1");
    await notifyEdited(OWNER, res, "UTC");
    const html = apiMock.callsOf("sendRichMessage")[0].rich_message.html;
    expect(html).toContain(`unix="${editedAt}"`);
  });

  it("markRead идёт через подключение этого чата и проверяет его право", async () => {
    await upsertConnection(connectionFromApi({ id: "bc2", user_chat_id: OWNER, is_enabled: true, rights: { can_read_messages: true } }));
    await upsertConnection(connectionFromApi({ id: "bc1", user_chat_id: OWNER, is_enabled: true, rights: {} }));
    await onNewMessage(bizMessage({ message_id: 1 }), "bc1");
    await expect(action({ type: "markRead", chatId: 555 }, ctx)).rejects.toMatchObject({ parameters: { code: "NO_RIGHT" } });
    expect(apiMock.callsOf("readBusinessMessage")).toHaveLength(0);
  });

  it("поиск по чужому чату отклоняется", async () => {
    await expect(search({ q: "x", chatId: 4242 }, ctx)).rejects.toMatchObject({ parameters: { code: "NOT_FOUND" } });
  });

  it("права в группе-архиве снял другой админ — архив всё равно помечается потерянным", async () => {
    await linkArchive({ ownerUserId: OWNER, chatId: -100777, title: "Архив" });
    const r = await onBotMembershipChange({ chat: { id: -100777 }, from: { id: 31337 }, new_chat_member: { status: "member", user: { id: 42 } } });
    expect(r).toMatchObject({ archive: "lost" });
    expect((await getArchive(OWNER))?.status).toBe("lost");
  });
});

import { previewable, eventView } from "../tgcloud/lib/view.js";

describe("стикеры и GIF в приложении", () => {
  it("статичный и видео-стикер показываются, .tgs — нет; GIF — до 5 МБ", () => {
    expect(previewable({ mediaType: "sticker", mediaMeta: { animated: false, video: false } })).toBe(true);
    expect(previewable({ mediaType: "sticker", mediaMeta: { video: true } })).toBe(true);
    expect(previewable({ mediaType: "sticker", mediaMeta: { animated: true } })).toBe(false);
    expect(previewable({ mediaType: "animation", fileSize: 4 * 1024 * 1024 })).toBe(true);
    expect(previewable({ mediaType: "animation", fileSize: 6 * 1024 * 1024 })).toBe(false);
    expect(eventView({ id: 1, chatId: 1, mediaType: "sticker", mediaMeta: { animated: false } }).hasThumb).toBe(true);
  });
});
