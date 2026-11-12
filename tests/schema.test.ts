import { describe, it, expect } from "vitest";
import { makeTestDb } from "../sdk-shim/testdb.js";
import { sql } from "drizzle-orm";

describe("schema", () => {
  it("создаёт все таблицы и индексы в SQLite", async () => {
    const db = await makeTestDb();
    const rows: any[] = await db.all(sql`select name, type from sqlite_master where type in ('table','index') order by name`);
    const names = rows.map((r) => r.name);
    for (const t of ["messages", "edits", "connections", "settings", "chat_prefs", "notif_batches", "processed_updates", "archives", "archive_topics", "app_meta"]) {
      expect(names).toContain(t);
    }
    expect(names).toContain("messages_conn_chat_msg_uq");
  });
});
