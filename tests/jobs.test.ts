import { describe, it, expect, beforeEach } from "vitest";
import { useFreshDb, bizMessage } from "./helpers.js";
import { apiMock, BotApiError } from "../sdk-shim/api.js";
import { onNewMessage, onConnection } from "../tgcloud/lib/events.js";
import { startMediaExport, drainJobs, cancelJob, activeJobs } from "../tgcloud/lib/jobs.js";

const OWNER = 999;
const photo = (id: string) => [{ file_id: id, file_unique_id: `${id}_u`, width: 1280, height: 960 }];
const T0 = Date.now() - 3_600_000;

async function seed(photos: number, docs = 0, voices = 0) {
  let n = 1;
  for (let i = 0; i < photos; i++) await onNewMessage(bizMessage({ message_id: n, date: T0 + n++ * 1000, text: undefined, photo: photo(`p${i}`) }), "bc1");
  for (let i = 0; i < docs; i++) await onNewMessage(bizMessage({ message_id: n, date: T0 + n++ * 1000, text: undefined, document: { file_id: `d${i}`, file_unique_id: `ud${i}` } }), "bc1");
  for (let i = 0; i < voices; i++) await onNewMessage(bizMessage({ message_id: n, date: T0 + n++ * 1000, text: undefined, voice: { file_id: `v${i}`, file_unique_id: `uv${i}`, duration: 3 } }), "bc1");
}

describe("прислать все файлы чата", () => {
  useFreshDb();
  beforeEach(async () => { await onConnection({ id: "bc1", user_chat_id: OWNER, is_enabled: true, rights: {} }); });

  it("пустой чат и вторая задача отклоняются", async () => {
    expect(await startMediaExport(OWNER, { chatId: 555 })).toEqual({ error: "EMPTY" });
    await seed(1);
    expect((await startMediaExport(OWNER, { chatId: 555 })).job?.total).toBe(1);
    expect(await startMediaExport(OWNER, { chatId: 555 })).toEqual({ error: "BUSY" });
  });

  it("альбомы по типу, одиночки своим методом, финальное сообщение", async () => {
    await seed(3, 2, 1);
    await startMediaExport(OWNER, { chatId: 555 });
    expect(await drainJobs(OWNER, "UTC")).toBe(6);
    const albums = apiMock.callsOf("sendMediaGroup").map((c: any) => c.media.map((m: any) => m.type));
    expect(albums).toEqual(expect.arrayContaining([["photo", "photo", "photo"], ["document", "document"]]));
    const voice = apiMock.callsOf("sendVoice");
    expect(voice).toHaveLength(1);
    expect(voice[0].caption).toBeUndefined();
    const texts = apiMock.callsOf("sendMessage").map((c: any) => c.text);
    expect(texts[0]).toMatch(/Пришлю все файлы/);
    expect(texts.at(-1)).toMatch(/Готово: прислано файлов — 6/);
    expect(await activeJobs(OWNER)).toEqual([]);
  });

  it("курсор: за вызов не больше заданного числа пачек, без повторов", async () => {
    await seed(25);
    await startMediaExport(OWNER, { chatId: 555 });
    await drainJobs(OWNER, "UTC", new Date(), 1);
    expect((await activeJobs(OWNER))[0]).toMatchObject({ done: 10, total: 25 });
    await drainJobs(OWNER, "UTC", new Date(), 1);
    await drainJobs(OWNER, "UTC", new Date(), 1);
    const ids = apiMock.callsOf("sendMediaGroup").flatMap((c: any) => c.media.map((m: any) => m.media));
    expect(ids).toHaveLength(25);
    expect(new Set(ids).size).toBe(25);
    expect(await activeJobs(OWNER)).toEqual([]);
  });

  it("429 откладывает задачу на retry_after, прогресс не теряется", async () => {
    await seed(5);
    await startMediaExport(OWNER, { chatId: 555 });
    apiMock.on("sendMediaGroup", () => { throw new BotApiError("sendMediaGroup", 429, "Too Many Requests", { retry_after: 40 }); });
    const now = new Date();
    expect(await drainJobs(OWNER, "UTC", now)).toBe(0);
    expect((await activeJobs(OWNER))[0].done).toBe(0);
    apiMock.on("sendMediaGroup", () => []);
    expect(await drainJobs(OWNER, "UTC", new Date(now.getTime() + 30_000))).toBe(0);
    expect(await drainJobs(OWNER, "UTC", new Date(now.getTime() + 41_000))).toBe(5);
  });

  it("отменённая задача больше не двигается", async () => {
    await seed(3);
    const { job } = await startMediaExport(OWNER, { chatId: 555 });
    expect(await cancelJob(OWNER, job!.id)).toBe(true);
    expect(await cancelJob(OWNER + 1, job!.id)).toBe(false);
    expect(await drainJobs(OWNER, "UTC")).toBe(0);
    expect(apiMock.callsOf("sendMediaGroup")).toHaveLength(0);
  });
});
