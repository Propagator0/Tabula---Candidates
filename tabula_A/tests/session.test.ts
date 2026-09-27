import { afterEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Session } from "../server/session";

const files: string[] = [];
afterEach(() => { for (const p of files.splice(0)) for (const s of ["", "-wal", "-shm"]) rmSync(p + s, { force: true }); });
function fresh() { const p = join(tmpdir(), `tabula-test-${crypto.randomUUID()}.db`); files.push(p); return Session.open(p, true); }

describe("Session", () => {
  test("introspects, pages, and safely updates rows", () => {
    const s = fresh();
    s.sql("CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL); INSERT INTO notes VALUES (1, 'hello');");
    const page = s.rows("notes", 0, 50);
    expect(page.cols).toEqual(["id", "body"]);
    expect(page.rows).toEqual([[1, "hello"]]);
    s.updateCell("notes", "body", page.keys[0], "world'); DROP TABLE notes; --");
    expect(s.rows("notes", 0, 50).rows[0][1]).toBe("world'); DROP TABLE notes; --");
    s.deleteRow("notes", page.keys[0]);
    expect(s.rows("notes", 0, 50).rows).toHaveLength(0);
    s.close();
  });

  test("applies a checked migration", () => {
    const s = fresh();
    s.sql("CREATE TABLE a (id INTEGER PRIMARY KEY);");
    const before = s.info();
    const result = s.migrate([{ kind: "ALTER", title: "add name", table: "a", sql: "ALTER TABLE a ADD COLUMN name TEXT" }], before.schemaVersion, true);
    expect(result.committed).toBe(true);
    expect(s.schema().tables[0].cols.map(c => c.name)).toEqual(["id", "name"]);
    expect(s.info().userVersion).toBe(before.userVersion + 1);
    s.close();
  });

  test("refuses a lossy visual rebuild", () => {
    const s = fresh();
    s.sql("CREATE TABLE guarded (id INTEGER PRIMARY KEY, n INTEGER CHECK (n > 0));");
    expect(() => s.migrate([{ kind: "REBUILD", title: "rebuild", table: "guarded", sql: "SELECT 1" }], s.schemaVersion(), true)).toThrow("Refusing to rebuild");
    s.close();
  });
});
