// Платформа отклоняет выкладку, если static.headers задаёт заголовок, который она держит за собой.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

function parseJsonc(src: string): any {
  let out = "";
  for (let i = 0, inStr = false; i < src.length; i++) {
    const c = src[i];
    if (inStr) { out += c; if (c === "\\") out += src[++i]; else if (c === '"') inStr = false; continue; }
    if (c === '"') { inStr = true; out += c; continue; }
    if (c === "/" && src[i + 1] === "/") { while (i < src.length && src[i] !== "\n") i++; out += "\n"; continue; }
    if (c === "/" && src[i + 1] === "*") { i = src.indexOf("*/", i + 2) + 1; continue; }
    out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

// Из схемы @tgcloud/cli (static.headers[].set): «Not settable: …».
const NOT_SETTABLE = ["content-type", "content-length", "content-encoding", "etag", "last-modified", "vary", "set-cookie", "location", "x-content-type-options"];

describe("tgcloud.jsonc static.headers", () => {
  const cfg = parseJsonc(readFileSync(new URL("../tgcloud.jsonc", import.meta.url), "utf8"));
  const rules: { path: string; set: Record<string, string | null> }[] = cfg.static?.headers ?? [];

  it("не задаёт заголовки, которые платформа не даёт менять", () => {
    const bad = rules.flatMap((r) => Object.keys(r.set ?? {})).filter((h) => NOT_SETTABLE.includes(h.toLowerCase()));
    expect(bad).toEqual([]);
  });

  it("не запрещает открытие в iframe (Telegram Web)", () => {
    for (const r of rules) {
      for (const [h, v] of Object.entries(r.set ?? {})) {
        expect(h.toLowerCase()).not.toBe("x-frame-options");
        if (h.toLowerCase() === "content-security-policy") expect(String(v)).not.toMatch(/frame-ancestors/);
      }
    }
  });
});
