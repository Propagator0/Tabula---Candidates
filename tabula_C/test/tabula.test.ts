// bun test
//
// These run the migration code the browser ships (pulled straight out of
// web/Tabula.dc.html) against real SQLite files, then look inside the files
// to check what actually happened.

import { describe, expect, test, beforeEach, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Session } from "../server/session";
import { splitSql } from "../server/sqlsplit";
import { buildDemo } from "../scripts/demo";

const html = readFileSync(join(import.meta.dir, "..", "web", "Tabula.dc.html"), "utf8");
const js = html.match(/data-dc-script[^>]*>([\s\S]*)<\/script>/)![1];
const L = new Function("DCLogic", "React", js + "\nreturn { modelFromSchema, diff, migrationText, clone, wire };")(
  class {}, { createRef: () => ({}), createElement: () => null });

const dir = mkdtempSync(join(tmpdir(), "tabula-test-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
let n = 0, s: Session;
beforeEach(() => { const p = join(dir, `demo${++n}.db`); buildDemo(p, 0.05); s = Session.open(p); });

// Load the model the way the browser does, edit it, diff it.
function edit(fn: (ts: any[]) => void) {
  const schema = s.schema(), loadedAt = s.schemaVersion();   // the version the model was read from
  const base = L.modelFromSchema(schema, {});
  const cur = L.clone(base);
  fn(cur);
  const ops = L.diff(base, cur, schema.triggers);
  return { ops, run: (commit = true) => s.migrate(ops.map(L.wire), loadedAt, commit) };
}
const T = (ts: any[], name: string) => ts.find(t => t.name === name);
const C = (t: any, name: string) => t.cols.find((c: any) => c.name === name);
// s.db runs with safeIntegers; read test results back as plain numbers
const plain = (r: any) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === "bigint" ? Number(v) : v]));
const q = (sql: string, ...a: any[]) => (s.db.query(sql).all(...a) as any[]).map(plain);
const one = (sql: string, ...a: any[]) => Object.values(plain(s.db.query(sql).get(...a)))[0];

describe("reading a real database", () => {
  test("the mockup schema round-trips with nothing pending", () => {
    const schema = s.schema();
    expect(schema.tables.map(t => t.name).sort()).toEqual(["comments", "projects", "sessions", "tags", "task_tags", "tasks", "users"]);
    expect(schema.views.map(v => v.name).sort()).toEqual(["v_open_tasks", "v_project_stats"]);
    expect(schema.triggers.map(t => t.name)).toEqual(["trg_comments_touch_task"]);
    expect(schema.tables.flatMap(t => t.indexes).length).toBe(6);
    expect(schema.tables.every(t => t.lossy.length === 0)).toBe(true);
    const m = L.modelFromSchema(schema, {});
    expect(C(T(m, "users"), "email").uq).toBe(true);
    expect(C(T(m, "tasks"), "assignee_id").fk.onDelete).toBe("SET NULL");
    expect(T(m, "task_tags").withoutRowid).toBe(true);
    expect(T(m, "task_tags").cols.filter((c: any) => c.pk).length).toBe(2);
    expect(L.diff(m, L.clone(m), schema.triggers)).toEqual([]);
  });

  test("features the canvas can't draw are detected, and block rebuilds", () => {
    s.db.run("CREATE TABLE guarded (id INTEGER PRIMARY KEY, qty INTEGER CHECK (qty >= 0), name TEXT COLLATE NOCASE)");
    const t = s.schema().tables.find(t => t.name === "guarded")!;
    expect(t.lossy).toContain("CHECK constraint");
    expect(t.lossy).toContain("COLLATE");
    const e = edit(ts => { C(T(ts, "guarded"), "qty").type = "REAL"; });
    expect(e.ops.map((o: any) => o.kind)).toEqual(["BLOCKED"]);
    const r = edit(ts => { T(ts, "guarded").name = "guarded2"; });
    expect(r.ops.map((o: any) => o.kind)).toEqual(["RENAME"]);           // SQLite renames keep the CHECK
    r.run();
    expect(String(one("SELECT sql FROM sqlite_schema WHERE name = 'guarded2'"))).toContain("CHECK");
  });
});

describe("migrations", () => {
  test("the naive rebuild (what the prototype generated) fails on this file", () => {
    // Why legacy_alter_table is there: the rename re-checks views, and
    // v_open_tasks points at the table that was just dropped.
    const db = s.db;
    db.run("PRAGMA foreign_keys = OFF"); db.run("BEGIN");
    db.run("CREATE TABLE _new_tasks AS SELECT * FROM tasks"); db.run("DROP TABLE tasks");
    expect(() => db.run("ALTER TABLE _new_tasks RENAME TO tasks")).toThrow(/error in view/);
    db.run("ROLLBACK");
  });

  test("column rename + type change: rename runs first, rebuild keeps data, views and indexes", () => {
    const before = one("SELECT count(*) FROM tasks"), uv = one("PRAGMA user_version") as number;
    const e = edit(ts => { const t = T(ts, "tasks"); C(t, "title").name = "summary"; C(t, "priority").type = "TEXT"; });
    expect(e.ops.map((o: any) => o.kind)).toEqual(["ALTER", "REBUILD"]);
    e.run();
    expect(one("SELECT count(*) FROM tasks")).toBe(before);
    expect(q("SELECT name, type FROM pragma_table_info('tasks') WHERE name IN ('summary','priority')"))
      .toEqual([{ name: "summary", type: "TEXT" }, { name: "priority", type: "TEXT" }]);
    expect(String(one("SELECT sql FROM sqlite_schema WHERE name = 'v_open_tasks'"))).toContain("summary");
    expect(q("SELECT * FROM v_open_tasks LIMIT 1").length).toBe(1);
    expect(q("SELECT name FROM pragma_index_list('tasks')").length).toBe(3);
    expect(one("PRAGMA user_version")).toBe(uv + 1);
    expect(one("PRAGMA foreign_keys")).toBe(1);                         // restored afterwards
  });

  test("a rebuild re-creates the table's triggers, and they still fire", () => {
    const e = edit(ts => { C(T(ts, "comments"), "body").nn = false; });
    expect(e.ops[0].kind).toBe("REBUILD");
    e.run();
    expect(q("SELECT name FROM sqlite_schema WHERE type = 'trigger'").map(r => r.name)).toEqual(["trg_comments_touch_task"]);
    const task = q("SELECT id FROM tasks WHERE status = 'todo' LIMIT 1")[0].id;
    s.db.run("INSERT INTO comments (task_id, author_id, body) VALUES (?, 1, NULL)", [task]);
    expect(one("SELECT status FROM tasks WHERE id = ?", task)).toBe("doing");
  });

  test("hidden rowids survive a rebuild", () => {
    s.db.run("CREATE TABLE notes (body TEXT)");
    for (let i = 0; i < 10; i++) s.db.run("INSERT INTO notes VALUES (?)", ["n" + i]);
    s.db.run("DELETE FROM notes WHERE rowid IN (2, 5, 6)");
    const before = q("SELECT rowid, body FROM notes");
    edit(ts => { C(T(ts, "notes"), "body").nn = true; }).run();
    expect(q("SELECT rowid, body FROM notes")).toEqual(before);
  });

  test("AUTOINCREMENT keeps its high-water mark", () => {
    s.db.run("CREATE TABLE seqs (id INTEGER PRIMARY KEY AUTOINCREMENT, v TEXT)");
    for (let i = 0; i < 5; i++) s.db.run("INSERT INTO seqs (v) VALUES ('x')");
    s.db.run("DELETE FROM seqs WHERE id > 3");
    edit(ts => { C(T(ts, "seqs"), "v").nn = true; }).run();
    expect(String(one("SELECT sql FROM sqlite_schema WHERE name = 'seqs'"))).toContain("AUTOINCREMENT");
    s.db.run("INSERT INTO seqs (v) VALUES ('y')");
    expect(one("SELECT max(id) FROM seqs")).toBe(6);                    // not 4: ids 4 and 5 stay retired
  });

  test("breaking a view rolls everything back", () => {
    const sv = s.schemaVersion();
    const e = edit(ts => { const t = T(ts, "tasks"); t.cols = t.cols.filter((c: any) => c.name !== "status"); t.indexes = t.indexes.filter((i: any) => i.name !== "idx_tasks_assignee_status"); });
    expect(() => e.run()).toThrow(/would break view v_open_tasks/);
    expect(s.schemaVersion()).toBe(sv);
    expect(q("SELECT name FROM pragma_table_info('tasks') WHERE name = 'status'").length).toBe(1);
  });

  test("a foreign key the data doesn't satisfy is refused", () => {
    const sv = s.schemaVersion();
    const e = edit(ts => { const tags = T(ts, "tags"); C(T(ts, "comments"), "author_id").fk = { t: tags.id, c: C(tags, "id").id, onDelete: "CASCADE", onUpdate: "NO ACTION" }; });
    expect(() => e.run()).toThrow(/Foreign key check failed: comments → tags/);
    expect(s.schemaVersion()).toBe(sv);
  });

  test("dry run checks everything and writes nothing", () => {
    const sv = s.schemaVersion();
    const r = edit(ts => { C(T(ts, "tasks"), "priority").type = "REAL"; }).run(false);
    expect(r.committed).toBe(false);
    expect(r.statements).toBeGreaterThan(5);
    expect(s.schemaVersion()).toBe(sv);
  });

  test("an out-of-date model is refused", () => {
    const e = edit(ts => { T(ts, "tags").name = "labels"; });
    const other = new Database(s.path); other.run("CREATE TABLE sneaky (x)"); other.close();
    expect(() => e.run()).toThrow(/changed on disk/);
  });

  test("keyword names are quoted", () => {
    s.db.run(`CREATE TABLE "order" ("group" TEXT, "select" INTEGER)`);
    s.db.run(`INSERT INTO "order" VALUES ('a', 1)`);
    edit(ts => { C(T(ts, "order"), "select").nn = true; }).run();
    expect(q(`SELECT * FROM "order"`)).toEqual([{ group: "a", select: 1 }]);
  });

  test("the copyable migration is valid SQL on a fresh copy", () => {
    const e = edit(ts => { C(T(ts, "comments"), "body").nn = false; T(ts, "tags").name = "labels"; });
    const text = L.migrationText(e.ops, s.info());
    const copy = join(dir, "copy.db");
    buildDemo(copy, 0.05);
    const db = new Database(copy);
    for (const st of splitSql(text)) db.run(st.sql);
    expect((db.query("SELECT count(*) AS n FROM sqlite_schema WHERE type = 'trigger'").get() as any).n).toBe(1);
    expect((db.query("SELECT count(*) AS n FROM sqlite_schema WHERE name = 'labels'").get() as any).n).toBe(1);
    db.close();
  });
});

describe("SQL console", () => {
  test("splits scripts, including trigger bodies", () => {
    const parts = splitSql(`SELECT 'a;b'; -- c;
      CREATE TRIGGER x AFTER INSERT ON t BEGIN UPDATE t SET v = CASE WHEN 1 THEN 2 END; SELECT 1; END;
      /* ; */ SELECT "q;";`);
    expect(parts.length).toBe(3);
    expect(parts[1].sql).toMatch(/^CREATE TRIGGER[\s\S]*END$/);
  });

  test("runs every statement and reports the last result", () => {
    const r = s.sql("UPDATE tags SET color = NULL WHERE id = 1; SELECT id, color FROM tags WHERE id = 1;");
    expect(r.statements).toBe(2);
    expect(r.result!.rows).toEqual([[1, null]]);
  });

  test("duplicate column names survive, big results are capped", () => {
    expect(s.sql("SELECT 1 AS id, 2 AS id").result!.rows).toEqual([[1, 2]]);
    const big = s.sql("WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n LIMIT 100000) SELECT i FROM n");
    expect(big.result!.truncated).toBe(true);
    expect(big.result!.rows.length).toBe(1000);
  });

  test("errors say which statement", () => {
    try { s.sql("SELECT 1; SELECT nope FROM tags;"); throw new Error("no throw"); }
    catch (e: any) { expect(e.message).toMatch(/no such column/); expect(e.extra.statement).toBe(2); }
  });

  test("64-bit integers and blobs make it into JSON intact", () => {
    const r = s.sql("SELECT 9007199254740993 AS big, x'deadbeef' AS b");
    expect(r.result!.rows[0]).toEqual(["9007199254740993", { $blob: 4, hex: "deadbeef" }]);
  });
});

describe("HTTP server", () => {
  test("wrong Host and missing token are refused", async () => {
    const p = join(dir, "http.db"); buildDemo(p, 0.02);
    const proc = Bun.spawn(["bun", join(import.meta.dir, "..", "server", "main.ts"), p, "--port", "47311"], { stdout: "pipe", stderr: "inherit" });
    try {
      const reader = proc.stdout.getReader(); await reader.read();         // first line = listening
      const base = "http://127.0.0.1:47311";
      const page = await (await fetch(base + "/")).text();
      const token = page.match(/"token":"([^"]+)"/)![1];
      expect((await fetch(base + "/api/state")).status).toBe(403);
      expect((await fetch(base + "/api/state", { headers: { "x-tabula-token": token, host: "evil.example:47311" } })).status).toBe(421);
      const ok = await (await fetch(base + "/api/state", { headers: { "x-tabula-token": token } })).json();
      expect(ok.db.name).toBe("http.db");
      expect(ok.schema.tables.length).toBe(7);
      expect((await fetch(base + "/vendor/../../server/main.ts")).status).toBe(404);
    } finally { proc.kill(); await proc.exited; }
  });
});
