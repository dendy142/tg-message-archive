import { describe, it, expect } from "vitest";
import { useFreshDb } from "./helpers.js";
import { apiMock, BotApiError } from "../sdk-shim/api.js";
import { sendView, sendPlain, editViewAt } from "../tgcloud/lib/runtime.js";
import { ensureSettings } from "../tgcloud/lib/repo/state.js";
import { outboxHead, hasOutbox } from "../tgcloud/lib/runtime.js";

const CHAT = 999;
const err = (method: string, code: number, description: string, params?: Record<string, any>) => () => { throw new BotApiError(method, code, description, params); };
const richRejected = () => apiMock.on("sendRichMessage", err("sendRichMessage", 400, "Bad Request: can't parse rich message"));

function balanced(html: string): boolean {
  const stack: string[] = [];
  for (const m of html.matchAll(/<(\/?)([a-z][a-z0-9-]*)\b[^>]*>/gi)) {
    const [, close, name] = m;
    if (!close) stack.push(name.toLowerCase());
    else if (stack.pop() !== name.toLowerCase()) return false;
  }
  return stack.length === 0;
}

describe("sendView: rich и деградация в HTML", () => {
  useFreshDb();

  it("обычный путь: sendRichMessage, возвращается message_id, sendMessage не зовётся", async () => {
    apiMock.on("sendRichMessage", () => ({ message_id: 4242 }));
    expect(await sendView(CHAT, { html: "<p>привет</p>" })).toBe(4242);
    expect(apiMock.callsOf("sendMessage")).toHaveLength(0);
    expect(apiMock.callsOf("sendRichMessage")[0]).toMatchObject({ chat_id: CHAT, rich_message: { html: "<p>привет</p>" } });
  });

  it("silent превращается в disable_notification", async () => {
    await sendView(CHAT, { html: "<p>тихо</p>", silent: true });
    expect(apiMock.callsOf("sendRichMessage")[0].disable_notification).toBe(true);
  });

  it("400 на sendRichMessage — запасной обычный sendMessage с parse_mode HTML", async () => {
    richRejected();
    apiMock.on("sendMessage", () => ({ message_id: 77 }));
    const id = await sendView(CHAT, { html: "<h3>Заголовок</h3><p>текст &amp; ещё</p>", reply_markup: { inline_keyboard: [] } });
    expect(id).toBe(77);
    const calls = apiMock.callsOf("sendMessage");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ chat_id: CHAT, parse_mode: "HTML", link_preview_options: { is_disabled: true } });
    expect(calls[0].text).toContain("<b>Заголовок</b>");
    expect(calls[0].text).not.toMatch(/<h3>|<p>/);
    expect(calls[0].reply_markup).toEqual({ inline_keyboard: [] });
    expect(await hasOutbox(CHAT)).toBe(false);
  });

  it("при фолбэке файлы уходят отдельными документами", async () => {
    richRejected();
    const file = { bytes: new Uint8Array([1]) } as any;
    await sendView(CHAT, { html: "<p>с файлом</p>", media: [{ id: "archive", file }] });
    expect(apiMock.callsOf("sendMessage")).toHaveLength(1);
    expect(apiMock.callsOf("sendDocument")).toHaveLength(1);
    expect(apiMock.callsOf("sendDocument")[0].document).toBe(file);
  });

  it("400 и от запасного sendMessage — ошибка уходит наружу, в очередь не кладётся", async () => {
    richRejected();
    apiMock.on("sendMessage", err("sendMessage", 400, "Bad Request: chat not found"));
    await expect(sendView(CHAT, { html: "<p>x</p>" })).rejects.toMatchObject({ code: 400 });
    expect(await hasOutbox(CHAT)).toBe(false);
  });

  it("direct: ошибки наружу без очереди и без отметки о блокировке", async () => {
    apiMock.on("sendRichMessage", err("sendRichMessage", 429, "Too Many Requests", { retry_after: 5 }));
    await expect(sendView(CHAT, { html: "<p>x</p>" }, { direct: true })).rejects.toMatchObject({ code: 429 });
    expect(await hasOutbox(CHAT)).toBe(false);
  });
});

describe("деление длинного HTML на части", () => {
  useFreshDb();
  const long = () => `<b>${Array.from({ length: 120 }, (_, i) => `строка номер ${i} `.padEnd(80, "·")).join("\n")}</b>`;

  it("несколько sendMessage, теги в каждой части сбалансированы, длина ≤ 3500", async () => {
    richRejected();
    const html = long();
    expect(html.length).toBeGreaterThan(7000);
    await sendView(CHAT, { html });
    const parts = apiMock.callsOf("sendMessage").map((c: any) => c.text as string);
    expect(parts.length).toBeGreaterThanOrEqual(3);
    for (const t of parts) {
      expect(t.length).toBeLessThanOrEqual(3500);
      expect(balanced(t)).toBe(true);
      expect(t.startsWith("<b>")).toBe(true);
    }
    const joined = parts.join("\n").replace(/<\/?b>/g, "");
    for (const i of [0, 59, 119]) expect(joined).toContain(`строка номер ${i} `);
    expect(joined.indexOf("строка номер 10 ")).toBeLessThan(joined.indexOf("строка номер 100 "));
  });

  it("reply_markup только на последней части", async () => {
    richRejected();
    const markup = { inline_keyboard: [[{ text: "Открыть", url: "https://example.com" }]] };
    await sendView(CHAT, { html: long(), reply_markup: markup });
    const calls = apiMock.callsOf("sendMessage");
    expect(calls.length).toBeGreaterThanOrEqual(3);
    calls.slice(0, -1).forEach((c: any) => expect(c.reply_markup).toBeUndefined());
    expect(calls.at(-1).reply_markup).toEqual(markup);
  });

  it("возвращается id последней части", async () => {
    richRejected();
    let n = 0;
    apiMock.on("sendMessage", () => ({ message_id: 500 + n++ }));
    const id = await sendPlain(CHAT, { html: long() });
    expect(id).toBe(500 + apiMock.callsOf("sendMessage").length - 1);
  });

  it("короткий текст — одно сообщение", async () => {
    await sendPlain(CHAT, { html: "<b>коротко</b>", reply_markup: { x: 1 } });
    const calls = apiMock.callsOf("sendMessage");
    expect(calls).toHaveLength(1);
    expect(calls[0].reply_markup).toEqual({ x: 1 });
  });
});

describe("editViewAt", () => {
  useFreshDb();
  const v = { html: "<p>новый текст</p>" };

  it("успешная правка — true, в editMessageText уходит rich", async () => {
    expect(await editViewAt(CHAT, 10, v)).toBe(true);
    expect(apiMock.callsOf("editMessageText")[0]).toMatchObject({ chat_id: CHAT, message_id: 10, html: "<p>новый текст</p>" });
  });

  it("«message is not modified» — true (менять нечего)", async () => {
    apiMock.on("editMessageText", err("editMessageText", 400, "Bad Request: message is not modified: specified new message content and reply markup are exactly the same"));
    expect(await editViewAt(CHAT, 10, v)).toBe(true);
    expect(apiMock.callsOf("editMessageText")).toHaveLength(1);
  });

  it("«message can't be edited» — false, вызывающий пришлёт новое", async () => {
    apiMock.on("editMessageText", err("editMessageText", 400, "Bad Request: message can't be edited"));
    expect(await editViewAt(CHAT, 10, v)).toBe(false);
    expect(apiMock.callsOf("editMessageText")).toHaveLength(1);
  });

  it("«message to edit not found» — тоже false", async () => {
    apiMock.on("editMessageText", err("editMessageText", 400, "Bad Request: message to edit not found"));
    expect(await editViewAt(CHAT, 10, v)).toBe(false);
  });

  it("rich не принят (другой 400) — вторая попытка обычным HTML", async () => {
    let n = 0;
    apiMock.on("editMessageText", (p: any) => { if (n++ === 0) throw new BotApiError("editMessageText", 400, "Bad Request: can't parse"); return p; });
    expect(await editViewAt(CHAT, 10, v)).toBe(true);
    const calls = apiMock.callsOf("editMessageText");
    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatchObject({ parse_mode: "HTML", text: expect.stringContaining("новый текст") });
  });

  it("запасная правка тоже «not modified» — true", async () => {
    apiMock.on("editMessageText", (p: any) => {
      throw new BotApiError("editMessageText", 400, p.parse_mode ? "Bad Request: message is not modified" : "Bad Request: can't parse");
    });
    expect(await editViewAt(CHAT, 10, v)).toBe(true);
  });

  it("временный сбой (429, 502) и блокировка (403) — false, без исключения", async () => {
    for (const [code, d] of [[429, "Too Many Requests"], [502, "Bad Gateway"], [403, "Forbidden: bot was blocked by the user"]] as const) {
      apiMock.on("editMessageText", err("editMessageText", code, d, { retry_after: 3 }));
      expect(await editViewAt(CHAT, 10, v)).toBe(false);
    }
  });

  it("прочая ошибка (например, 401) летит наружу", async () => {
    apiMock.on("editMessageText", err("editMessageText", 401, "Unauthorized"));
    await expect(editViewAt(CHAT, 10, v)).rejects.toMatchObject({ code: 401 });
  });
});

describe("временные сбои и блокировка", () => {
  useFreshDb();
  const MIN = 60_000;

  it("429 — экран в outbox, sendView возвращает null, ожидание не меньше retry_after", async () => {
    apiMock.on("sendRichMessage", err("sendRichMessage", 429, "Too Many Requests: retry after 120", { retry_after: 120 }));
    const t0 = Date.now();
    expect(await sendView(CHAT, { html: "<p>позже</p>", reply_markup: { k: 1 }, silent: true })).toBeNull();
    const head = await outboxHead(CHAT);
    expect(head).toBeTruthy();
    expect(head!.payload).toMatchObject({ html: "<p>позже</p>", reply_markup: { k: 1 }, silent: true });
    expect(head!.lastError).toContain("Too Many Requests");
    expect(new Date(head!.nextAt).getTime()).toBeGreaterThanOrEqual(t0 + 120_000);
    expect(new Date(head!.nextAt).getTime()).toBeLessThan(t0 + 120_000 + MIN);
    expect((await ensureSettings(CHAT)).notificationsBlocked).toBeFalsy();
  });

  it("5xx без retry_after — очередь с минимальной паузой 5 с", async () => {
    apiMock.on("sendRichMessage", err("sendRichMessage", 502, "Bad Gateway"));
    const t0 = Date.now();
    expect(await sendView(CHAT, { html: "<p>x</p>" })).toBeNull();
    const at = new Date((await outboxHead(CHAT))!.nextAt).getTime();
    expect(at).toBeGreaterThanOrEqual(t0 + 5_000);
    expect(at).toBeLessThan(t0 + 5_000 + MIN);
  });

  it("сетевая ошибка (не BotApiError) тоже считается временной", async () => {
    apiMock.on("sendRichMessage", () => { throw new Error("fetch failed"); });
    expect(await sendView(CHAT, { html: "<p>x</p>" })).toBeNull();
    expect(await hasOutbox(CHAT)).toBe(true);
  });

  it("экран с файлами без рецепта пересборки в очередь не кладётся — ошибка наружу", async () => {
    apiMock.on("sendRichMessage", err("sendRichMessage", 429, "Too Many Requests", { retry_after: 1 }));
    const file = { bytes: new Uint8Array([1]) } as any;
    await expect(sendView(CHAT, { html: "<p>x</p>", media: [{ id: "archive", file }] })).rejects.toMatchObject({ code: 429 });
    expect(await hasOutbox(CHAT)).toBe(false);
  });

  it("с рецептом пересборки файловый экран в очередь кладётся (без InputFile)", async () => {
    apiMock.on("sendRichMessage", err("sendRichMessage", 429, "Too Many Requests", { retry_after: 1 }));
    const file = { bytes: new Uint8Array([1]) } as any;
    expect(await sendView(CHAT, { html: "<p>x</p>", media: [{ id: "archive", file }], rebuild: { fn: "wipe", args: { a: 1 } } })).toBeNull();
    const payload = (await outboxHead(CHAT))!.payload as any;
    expect(payload.rebuild).toEqual({ fn: "wipe", args: { a: 1 } });
    expect(payload.media).toBeUndefined();
  });

  it("403 — настройки получают notificationsBlocked, в очередь ничего не идёт, результат null", async () => {
    apiMock.on("sendRichMessage", err("sendRichMessage", 403, "Forbidden: bot was blocked by the user"));
    expect((await ensureSettings(CHAT)).notificationsBlocked).toBeFalsy();
    expect(await sendView(CHAT, { html: "<p>x</p>" })).toBeNull();
    expect((await ensureSettings(CHAT)).notificationsBlocked).toBe(true);
    expect(await hasOutbox(CHAT)).toBe(false);
    expect(apiMock.callsOf("sendMessage")).toHaveLength(0);
  });

  it("403 от запасного sendMessage после отказа rich — тоже блокировка", async () => {
    richRejected();
    apiMock.on("sendMessage", err("sendMessage", 403, "Forbidden: user is deactivated"));
    expect(await sendView(CHAT, { html: "<p>x</p>" })).toBeNull();
    expect((await ensureSettings(CHAT)).notificationsBlocked).toBe(true);
  });
});
