// Локальная замена sdk/db: Drizzle (sqlite-core) поверх libsql в памяти. Код пишется под обе
// среды: явные .all/.get/.run, .get() сравнивается с ?? null.
import * as core from "drizzle-orm/sqlite-core";
import * as orm from "drizzle-orm";

// .deprecated(): помеченное не попадает в таблицу Drizzle, как невидимое в рантайме платформы.
const markDeprecated = function () { /** @type {any} */ (this).__deprecated = true; return this; };
/** @type {any} */ (orm.ColumnBuilder.prototype).deprecated = markDeprecated;
/** @type {any} */ (core.IndexBuilder.prototype).deprecated = markDeprecated;
const live = (obj) => Object.fromEntries(Object.entries(obj ?? {}).filter(([, v]) => !(/** @type {any} */ (v))?.__deprecated));

/** @type {typeof core.sqliteTable} */
export const table = /** @type {any} */ ((name, columns, extra) => core.sqliteTable(name, /** @type {any} */ (live(columns)),
  extra && (/** @param {any} t */ (t) => { const r = extra(t); return /** @type {any} */ (Array.isArray(r) ? r.filter((x) => !x?.__deprecated) : live(r)); })));
export const integer = core.integer;
export const text = core.text;
export const real = core.real;
export const float = core.real;
export const numeric = core.numeric;
export const blob = core.blob;
/** @param {string} [name] */
export const boolean = (name) => (name ? core.integer(name, { mode: "boolean" }) : core.integer({ mode: "boolean" }));
/** @param {string} [name] */
export const json = (name) => (name ? core.text(name, { mode: "json" }) : core.text({ mode: "json" }));
export const index = core.index;
export const uniqueIndex = core.uniqueIndex;
export const primaryKey = core.primaryKey;
export const unique = core.unique;
export const check = core.check;

export const {
  sql, eq, ne, gt, gte, lt, lte, like, notLike, isNull, isNotNull, and, or, not,
  between, notBetween, inArray, notInArray, asc, desc, count, sum, avg, min, max,
} = orm;

// Платформа не экранирует ключи проекции select (`count(*) AS all` давал там «Server error»);
// зарезервированные слова SQLite здесь отвергаем.
const RESERVED_ALIASES = new Set(["add", "all", "alter", "and", "as", "autoincrement", "between", "case", "check", "collate",
  "commit", "constraint", "create", "default", "deferrable", "delete", "distinct", "drop", "else", "escape", "except", "exists",
  "foreign", "from", "group", "having", "in", "index", "insert", "intersect", "into", "is", "isnull", "join", "limit", "not",
  "nothing", "notnull", "null", "on", "or", "order", "primary", "references", "returning", "select", "set", "table", "then",
  "to", "transaction", "union", "unique", "update", "using", "values", "when", "where"]);

/** @param {Record<string, unknown> | undefined} fields */
function checkProjection(fields) {
  for (const k of Object.keys(fields ?? {})) {
    if (RESERVED_ALIASES.has(k.toLowerCase())) {
      throw new Error(`SQLITE_ERROR: near "${k}": syntax error (sdk-shim: ключ select() — ключевое слово SQL, на платформе псевдоним не экранируется)`);
    }
  }
}

// Платформа ломается на пакетной вставке с разным набором колонок и >999 параметров («Run error»);
// требуем одинаковые колонки и не больше 999 параметров.
export const MAX_SQL_VARS = 999;

/** @param {unknown} values */
function checkInsertVars(values) {
  if (!Array.isArray(values) || values.length < 2) return;
  const sig = (/** @type {any} */ r) => Object.keys(r ?? {}).sort().join(',');
  const first = sig(values[0]);
  if (values.some((r) => sig(r) !== first)) throw new Error("sdk-shim: строки пакетной вставки с разным набором колонок — дополните недостающие явно");
  const vars = values.length * Object.keys(values[0] ?? {}).length;
  if (vars > MAX_SQL_VARS) throw new Error(`SQLITE_ERROR: too many SQL variables (${vars} > ${MAX_SQL_VARS}; sdk-shim: пакетную вставку режьте на части)`);
}

/** @type {import("drizzle-orm/libsql").LibSQLDatabase<any> | null} */
let current = null;

export function __setDb(next) { current = next; }

/**
 * Прокси: база в тестах пересоздаётся, поэтому разыменовываем при каждом обращении.
 * @type {import("drizzle-orm/libsql").LibSQLDatabase<any>}
 */
export const db = /** @type {any} */ (new Proxy({}, {
  get(_, key) {
    if (!current) throw new Error("sdk-shim: db is not initialised — call __setDb() in the test setup");
    const v = /** @type {any} */ (current)[key];
    if (key === "insert") {
      return (/** @type {any} */ t) => {
        const b = v.call(current, t);
        const values = b.values.bind(b);
        b.values = (/** @type {any} */ vals) => { checkInsertVars(vals); return values(vals); };
        return b;
      };
    }
    if (key === "select" || key === "selectDistinct") {
      return (/** @type {any} */ fields) => { checkProjection(fields); return v.call(current, fields); };
    }
    return typeof v === "function" ? v.bind(current) : v;
  },
}));

export default db;
