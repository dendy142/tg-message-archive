import { describe, it, expect } from "vitest";
import { entitiesToHtml } from "../tgcloud/lib/text.js";

describe("entities → HTML: санитизация", () => {
  const link = (url: string) => entitiesToHtml("жми", [{ type: "text_link", offset: 0, length: 3, url }]);

  it("http(s) и tg:// — ссылкой, с экранированием", () => {
    expect(link("https://x.y/?a=1&b=\"2\"")).toBe('<a href="https://x.y/?a=1&amp;b=&quot;2&quot;">жми</a>');
    expect(link("tg://resolve?domain=x")).toContain('<a href="tg://');
  });

  it("javascript:, data: и прочие схемы — просто текст", () => {
    for (const u of ["javascript:alert(1)", " JAVASCRIPT:alert(1)", "data:text/html,<script>", "vbscript:x", "//evil.example"]) {
      expect(link(u)).toBe("жми");
    }
  });

  it("язык блока кода и custom_emoji_id не дают вставить атрибут", () => {
    const pre = entitiesToHtml("x", [{ type: "pre", offset: 0, length: 1, language: 'js" onclick="x' }]);
    expect(pre).toBe("<pre>x</pre>");
    const emoji = entitiesToHtml("🙂", [{ type: "custom_emoji", offset: 0, length: 2, custom_emoji_id: '1" x="' }]);
    expect(emoji).toBe("🙂");
  });

  it("текст экранируется всегда", () => {
    expect(entitiesToHtml("<b>&", null)).toBe("&lt;b&gt;&amp;");
  });
});
