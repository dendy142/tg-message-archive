import { describe, it, expect, beforeEach } from "vitest";
import { useFreshDb, bizMessage } from "./helpers.js";
import { apiMock } from "../sdk-shim/api.js";
import { onNewMessage, onEdit, onDelete, onConnection } from "../tgcloud/lib/events.js";
import { buildExport } from "../tgcloud/lib/export.js";
import { sendExport, exportEstimate } from "../tgcloud/lib/export.js";
import * as msg from "../tgcloud/lib/repo/messages.js";

const OWNER = 999;
const text = (call: any) => new TextDecoder().decode(call.document.bytes);

describe("форматы выгрузки", () => {
  const row = {
    id: 1, chatId: 5, chatName: 'Иван "Ваня"', senderName: "<Иван>", senderUsername: "ivan", isOutgoing: false,
    text: 'a,"b"\nc', date: Date.UTC(2026, 0, 1, 10), isDeleted: true, deletedAt: Date.UTC(2026, 0, 2), oneTime: true,
    mirrorChatId: -1001234, mirrorThreadId: 7, mirrorMessageId: 9, fileId: "secret",
    edits: [{ oldText: "было", newText: "стало", editedAt: Date.UTC(2026, 0, 1, 11) }],
  };

  it("CSV: BOM, экранирование кавычек, правки и ссылка на копию", () => {
    const c = buildExport("csv", [row], { tz: "UTC", title: "t", scope: "s" }).content;
    expect(c.charCodeAt(0)).toBe(0xfeff);
    expect(c).toContain('"a,""b""\nc"');
    expect(c).toContain("«было» → «стало»");
    expect(c).toContain("https://t.me/c/1234/7/9");
    expect(c).toContain("@ivan");
  });

  it("HTML экранирует всё, JSON прячет служебные поля", () => {
    const h = buildExport("html", [row], { tz: "UTC", title: "<x>", scope: "s" }).content;
    expect(h).toContain("&lt;Иван&gt;");
    expect(h).not.toContain("<Иван>");
    expect(h).toContain("<del>было</del>");
    const j = JSON.parse(buildExport("json", [row], { tz: "UTC", title: "t", scope: "s" }).content)[0];
    expect(j.fileId).toBeUndefined();
    expect(j.edits[0]).toMatchObject({ oldText: "было", newText: "стало" });
    expect(j.archiveLink).toBe("https://t.me/c/1234/7/9");
  });

  it("Markdown — правки вложенным списком", () => {
    const m = buildExport("md", [row], { tz: "UTC", title: "t", scope: "s" }).content;
    expect(m).toMatch(/\n {2}- ✏️ .*«было» → «стало»/);
  });
});

describe("отправка выгрузки", () => {
  useFreshDb();
  beforeEach(async () => {
    await onConnection({ id: "bc1", user_chat_id: OWNER, is_enabled: true, rights: {} });
    for (let i = 1; i <= 5; i++) await onNewMessage(bizMessage({ message_id: i, text: `m${i}`, date: Math.floor(Date.UTC(2026, 9, i, 12) / 1000) }), "bc1");
    await onEdit(bizMessage({ message_id: 1, text: "m1!", date: Math.floor(Date.UTC(2026, 9, 1, 12) / 1000), edit_date: Math.floor(Date.UTC(2026, 9, 1, 13) / 1000) }), "bc1");
    await onDelete({ chat: { id: 555 }, message_ids: [2] }, "bc1");
  });

  it("несколько файлов вместо обрезания; правки внутри", async () => {
    const r = await sendExport(OWNER, "UTC", { format: "json" }, { pageSize: 2 });
    expect(r).toMatchObject({ rows: 5, files: 3 });
    const docs = apiMock.callsOf("sendDocument");
    expect(docs.map((d: any) => d.document.filename)).toEqual(["archive-all-1of3.json", "archive-all-2of3.json", "archive-all-3of3.json"]);
    const all = docs.flatMap((d: any) => JSON.parse(text(d)));
    expect(all).toHaveLength(5);
    expect(all.find((x: any) => x.text === "m1!").edits[0].oldText).toBe("m1");
    expect(docs[0].caption).toContain("часть 1 из 3");
  });

  it("свои даты и одноразовые/удалённые фильтры; оценка до запуска", async () => {
    expect(await exportEstimate(OWNER, "UTC", { from: "2026-10-02", to: "2026-10-03" })).toMatchObject({ rows: 2, files: 1 });
    await sendExport(OWNER, "UTC", { format: "csv", from: "2026-10-02", to: "2026-10-03" });
    expect(apiMock.callsOf("sendDocument")[0].document.filename).toBe("archive-2026-10-02_2026-10-03.csv");
    expect((await exportEstimate(OWNER, "UTC", { kind: "deleted" })).rows).toBe(1);
    await expect(sendExport(OWNER, "UTC", { kind: "oneTime" })).rejects.toMatchObject({ parameters: { code: "EMPTY" } });
    expect(await msg.countExport(OWNER, {})).toBe(5);
  });
});
