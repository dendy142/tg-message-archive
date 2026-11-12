import { describe, it, expect } from "vitest";
import { chunkHtml } from "../tgcloud/lib/text.js";

function balanced(html: string): boolean {
  const st: string[] = [];
  for (const m of html.matchAll(/<\/?([a-z][a-z0-9-]*)\b[^>]*>/gi)) {
    const name = m[1].toLowerCase();
    if (m[0][1] === "/") { if (st.pop() !== name) return false; } else if (name !== "br") st.push(name);
  }
  return st.length === 0;
}
const strip = (s: string) => s.replace(/<[^>]+>/g, "");

describe("chunkHtml", () => {
  it("короткий HTML — одна часть без изменений", () => {
    expect(chunkHtml("<b>x</b>", 100)).toEqual(["<b>x</b>"]);
  });

  it("длинная цитата: каждая часть сбалансирована, текст не теряется", () => {
    const lines = Array.from({ length: 400 }, (_, i) => `строка ${i} с текстом`);
    const html = `<b>Заголовок</b>\n<blockquote><b>${lines.join("\n")}</b></blockquote>\nхвост`;
    const parts = chunkHtml(html, 500);
    expect(parts.length).toBeGreaterThan(5);
    for (const p of parts) { expect(p.length).toBeLessThanOrEqual(500); expect(balanced(p)).toBe(true); }
    expect(parts.map(strip).join("").replace(/\s+/g, " ")).toBe(strip(html).replace(/\s+/g, " "));
    expect(parts[1].startsWith("<blockquote><b>")).toBe(true);
  });

  it("ссылка переоткрывается с тем же href", () => {
    const html = `<a href="https://x.y/?a=1&amp;b=2">${"слово ".repeat(200)}</a>`;
    const parts = chunkHtml(html, 300);
    for (const p of parts) { expect(balanced(p)).toBe(true); expect(p.startsWith('<a href="https://x.y/?a=1&amp;b=2">')).toBe(true); }
  });

  it("не разрывает HTML-сущности при резке длинной строки", () => {
    const html = "&amp;".repeat(400);
    for (const p of chunkHtml(html, 101)) expect(p).toMatch(/^(&amp;)+$/);
  });

  it("предпочитает резать по строкам вне <pre>", () => {
    const html = `${"a".repeat(80)}\n<pre>${"код\n".repeat(10)}</pre>\n${"b".repeat(80)}`;
    const parts = chunkHtml(html, 120);
    for (const p of parts) expect(balanced(p)).toBe(true);
    expect(parts[0]).toBe(`${"a".repeat(80)}\n`);
  });
});
