import { describe, it, expect, beforeEach } from "vitest";
import { useFreshDb, bizMessage } from "./helpers.js";
import { apiMock, BotApiError } from "../sdk-shim/api.js";
import { onNewMessage, onDelete, onConnection } from "../tgcloud/lib/events.js";
import { drainMirror } from "../tgcloud/lib/archive.js";
import { ALBUM_SETTLE_MS } from "../tgcloud/lib/media.js";
import { linkArchive, getArchive } from "../tgcloud/lib/archive.js";
import * as msg from "../tgcloud/lib/repo/messages.js";
import fileEp from "../tgcloud/endpoints/file.js";

const OWNER = 999;
const GROUP = -100500;
const later = () => new Date(Date.now() + ALBUM_SETTLE_MS + 1000);
const photo = (id: string, size = 100) => [{ file_id: `${id}_s`, file_unique_id: `${id}_us`, width: 90, height: 90 }, { file_id: id, file_unique_id: `${id}_u`, width: 1280, height: 960, file_size: size }];
let sentSeq = 5000;
const echo = (p: any) => ({ message_id: sentSeq++, chat: { id: p.chat_id }, photo: [{ file_id: `copy_${p.photo ?? p.media}`, file_unique_id: "c", width: 10, height: 10 }] });

describe("копии в группе-архиве", () => {
  useFreshDb();
  beforeEach(async () => {
    await onConnection({ id: "bc1", user_chat_id: OWNER, is_enabled: true, rights: {} });
    await linkArchive({ ownerUserId: OWNER, chatId: GROUP, title: "Архив" });
  });

  it("одиночное фото: копия в теме чата, запасной file_id сохранён", async () => {
    apiMock.on("sendPhoto", echo);
    await onNewMessage(bizMessage({ message_id: 1, text: undefined, photo: photo("p1") }), "bc1");
    const r = await drainMirror(OWNER, "UTC");
    expect(r.sent).toBe(1);
    expect(apiMock.callsOf("createForumTopic")).toHaveLength(1);
    const row = await msg.findByKey("bc1", 555, 1);
    expect(row).toMatchObject({ mirrorStatus: "done", mirrorChatId: GROUP, mirrorFileId: "copy_p1" });
  });

  it("альбом ждёт остальные файлы и уходит одним sendMediaGroup", async () => {
    for (const [i, id] of ["a", "b", "c"].entries()) {
      await onNewMessage(bizMessage({ message_id: 10 + i, text: undefined, media_group_id: "g1", photo: photo(id) }), "bc1");
    }
    expect((await drainMirror(OWNER, "UTC")).sent).toBe(0);
    apiMock.on("sendMediaGroup", (p: any) => p.media.map((m: any) => echo({ ...p, media: m.media })));
    const r = await drainMirror(OWNER, "UTC", later());
    expect(r.sent).toBe(3);
    const calls = apiMock.callsOf("sendMediaGroup");
    expect(calls).toHaveLength(1);
    expect(calls[0].media.map((m: any) => m.media)).toEqual(["a", "b", "c"]);
    expect(calls[0].message_thread_id).toBeTruthy();
    expect(apiMock.callsOf("sendPhoto")).toHaveLength(0);
    expect((await msg.findByKey("bc1", 555, 11))?.mirrorFileId).toBe("copy_b");
  });

  it("фото и документы одного альбома — разными альбомами", async () => {
    await onNewMessage(bizMessage({ message_id: 20, text: undefined, media_group_id: "g2", photo: photo("p") }), "bc1");
    await onNewMessage(bizMessage({ message_id: 21, text: undefined, media_group_id: "g2", photo: photo("q") }), "bc1");
    await onNewMessage(bizMessage({ message_id: 22, text: undefined, media_group_id: "g2", document: { file_id: "d1", file_unique_id: "ud1" } }), "bc1");
    await onNewMessage(bizMessage({ message_id: 23, text: undefined, media_group_id: "g2", document: { file_id: "d2", file_unique_id: "ud2" } }), "bc1");
    await drainMirror(OWNER, "UTC", later());
    const calls = apiMock.callsOf("sendMediaGroup");
    expect(calls.map((c: any) => c.media.map((m: any) => m.type))).toEqual([["photo", "photo"], ["document", "document"]]);
  });

  it("429 на альбоме: все файлы ждут, группа на паузе", async () => {
    for (const i of [0, 1]) await onNewMessage(bizMessage({ message_id: 30 + i, text: undefined, media_group_id: "g3", photo: photo(`x${i}`) }), "bc1");
    apiMock.on("sendMediaGroup", () => { throw new BotApiError("sendMediaGroup", 429, "Too Many Requests", { retry_after: 40 }); });
    const at = later();
    await drainMirror(OWNER, "UTC", at);
    for (const id of [30, 31]) expect((await msg.findByKey("bc1", 555, id))?.mirrorStatus).toBe("pending");
    expect(new Date((await getArchive(OWNER))!.retryAt!).getTime()).toBe(at.getTime() + 40_000);
  });

  it("голосовое: копия без подписи + тихий ответ с «кто/когда», при удалении правится он", async () => {
    await onNewMessage(bizMessage({ message_id: 40, text: undefined, voice: { file_id: "v1", file_unique_id: "uv1", duration: 3 } }), "bc1");
    await drainMirror(OWNER, "UTC");
    const voice = apiMock.callsOf("sendVoice")[0];
    expect(voice.caption).toBeUndefined();
    const note = apiMock.callsOf("sendMessage")[0];
    expect(note.reply_parameters.message_id).toBeTruthy();
    expect(note.disable_notification).toBe(true);
    const row = await msg.findByKey("bc1", 555, 40);
    expect(row?.mirrorCaptionMessageId).toBeTruthy();

    await onDelete({ chat: { id: 555 }, message_ids: [40] }, "bc1");
    await drainMirror(OWNER, "UTC");
    const edit = apiMock.callsOf("editMessageText")[0];
    expect(edit.message_id).toBe(row!.mirrorCaptionMessageId);
    expect(edit.text).toContain("удалено");
    expect(apiMock.callsOf("editMessageCaption")).toHaveLength(0);
  });

  it("исходный file_id протух — файл отдаётся по копии из группы", async () => {
    apiMock.on("sendPhoto", echo);
    await onNewMessage(bizMessage({ message_id: 50, text: undefined, photo: photo("old", 10) }), "bc1");
    await drainMirror(OWNER, "UTC");
    const row = await msg.findByKey("bc1", 555, 50);
    apiMock.on("getFileContent", (id: any) => {
      if (id === "old") throw new BotApiError("getFile", 400, "Bad Request: wrong file_id");
      return new Uint8Array([7]);
    });
    const r = await fileEp({ id: row!.id, kind: "full" }, { initData: { user: { id: OWNER } } });
    expect(r.dataUrl).toContain("base64,Bw==");
  });
});
