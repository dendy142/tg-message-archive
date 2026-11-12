// Свежая SQLite в памяти со схемой tgcloud/schema.js; на платформе таблицы создаёт tgcloud migrate.
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { getTableConfig, SQLiteSyncDialect, SQLiteTable } from "drizzle-orm/sqlite-core";
import { is, SQL } from "drizzle-orm";
import { __setDb } from "./db.js";

const dialect = new SQLiteSyncDialect();
const q = (name) => `"${name}"`;
const render = (/** @type {SQL} */ s) => {
  const { sql, params } = dialect.sqlToQuery(s);
  // В DDL параметры не допускаются (как и на платформе) — подставляем литералы.
  let i = 0;
  return sql.replace(/\?/g, () => {
    const p = params[i++];
    return typeof p === "number" ? String(p) : `'${String(p).replace(/'/g, "''")}'`;
  });
};

function defaultSql(col) {
  if (!col.hasDefault || col.default === undefined) return "";
  if (is(col.default, SQL)) return ` DEFAULT (${render(col.default)})`;
  const v = col.mapToDriverValue ? col.mapToDriverValue(col.default) : col.default;
  if (typeof v === "number") return ` DEFAULT ${v}`;
  if (typeof v === "boolean") return ` DEFAULT ${v ? 1 : 0}`;
  return ` DEFAULT '${String(v).replace(/'/g, "''")}'`;
}

export function tableDdl(t) {
  const cfg = getTableConfig(t);
  const cols = cfg.columns.map((c) => {
    let s = `${q(c.name)} ${c.getSQLType()}`;
    if (c.primary) s += " PRIMARY KEY" + (/** @type {any} */ (c).autoIncrement ? " AUTOINCREMENT" : "");
    if (c.notNull && !c.primary) s += " NOT NULL";
    if (c.isUnique) s += " UNIQUE";
    return s + defaultSql(c);
  });
  for (const pk of cfg.primaryKeys) cols.push(`PRIMARY KEY (${pk.columns.map((c) => q(c.name)).join(", ")})`);
  const out = [`CREATE TABLE ${q(cfg.name)} (${cols.join(", ")})`];
  for (const idx of cfg.indexes) {
    const ic = idx.config;
    const on = ic.columns.map((c) => (is(c, SQL) ? `(${render(c)})` : q(c.name))).join(", ");
    const where = ic.where ? ` WHERE ${render(ic.where)}` : "";
    out.push(`CREATE ${ic.unique ? "UNIQUE " : ""}INDEX ${q(ic.name)} ON ${q(cfg.name)} (${on})${where}`);
  }
  return out;
}

export async function makeTestDb() {
  const schema = await import("../tgcloud/schema.js");
  const client = createClient({ url: ":memory:" });
  const db = drizzle({ client, schema });
  for (const t of Object.values(schema)) {
    if (!is(t, SQLiteTable)) continue;
    for (const stmt of tableDdl(t)) await client.execute(stmt);
  }
  __setDb(db);
  return db;
}
