// tgcloud push отклоняет выкладку при >100 модулей в tgcloud/ («Too many modules per app»).
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Предел платформы: 100 модулей на бота. */
const MAX_MODULES = 100;

const ROOT = fileURLToPath(new URL("../tgcloud/", import.meta.url));

function modules(dir = ROOT): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return modules(p);
    return e.name.endsWith(".js") ? [p] : [];
  });
}

describe("модули tgcloud/", () => {
  const files = modules();

  it(`не больше ${MAX_MODULES} — иначе платформа не примет деплой`, () => {
    const rel = files.map((f) => path.relative(ROOT, f)).sort();
    expect(rel.length, `модулей ${rel.length} из ${MAX_MODULES}: объедините мелкие модули lib/`).toBeLessThanOrEqual(MAX_MODULES);
  });

  it("импортируют друг друга без циклов", () => {
    const deps = new Map(files.map((f) => {
      const src = readFileSync(f, "utf8");
      const specs = [...src.matchAll(/^(?:import|export)[^'"]*?from\s*['"](\.[^'"]+)['"]/gm)].map((m) => m[1]);
      return [f, specs.map((s) => path.resolve(path.dirname(f), s))];
    }));
    const cycles: string[] = [];
    const state = new Map<string, 1 | 2>();
    const visit = (f: string, stack: string[]) => {
      state.set(f, 1);
      for (const d of deps.get(f) ?? []) {
        if (state.get(d) === 1) cycles.push([...stack.slice(stack.indexOf(d)), d].map((x) => path.relative(ROOT, x)).join(" → "));
        else if (!state.has(d)) visit(d, [...stack, d]);
      }
      state.set(f, 2);
    };
    for (const f of files) if (!state.has(f)) visit(f, [f]);
    expect(cycles).toEqual([]);
  });
});
