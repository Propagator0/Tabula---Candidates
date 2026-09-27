// One open database file and everything the UI can do to it.
//
// A single long-lived connection. That matters for two SQLite settings the
// UI shows: foreign_keys and legacy_alter_table live on the CONNECTION, not
// in the file. Toggling foreign_keys in Tabula changes Tabula's session only;
// your app's own connection keeps whatever it sets.

import { Database } from "bun:sqlite";
import { existsSync, realpathSync, statSync } from "node:fs";
import { basename, dirname } from "node:path";
import { homedir } from "node:os";
import { introspect, qi, type Schema } from "./introspect";
import { splitSql } from "./sqlsplit";

export class TabulaError extends Error {
  constructor(message: string, public extra: Record<string, unknown> = {}) { super(message); }
}

export type Op = { kind: string; title: string; table?: string; sql: string };

const ROW_CAP = 2000;          // SQL console: rows sent to the browser per result
const tilde = (p: string) => { const h = homedir(); return p === h ? "~" : p.startsWith(h + "/") ? "~" + p.slice(h.length) : p; };

// JSON can't carry BigInt or bytes. Integers come out of SQLite as BigInt
// (safeIntegers) so 64-bit ids never lose precision; small ones turn back
// into plain numbers, huge ones travel as strings. BLOBs travel as a size
// plus the first bytes in hex.
export function enc(v: unknown): unknown {
  if (typeof v === "bigint") return v >= BigInt(Number.MIN_SAFE_INTEGER) && v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v.toString();
  if (v instanceof Uint8Array) return { $blob: v.length, hex: Buffer.from(v.subarray(0, 16)).toString("hex") };
  return v;
}

export class Session {
  readonly db: Database;
  readonly path: string;

  private constructor(path: string, db: Database) { this.path = path; this.db = db; }

  static open(path: string, create = false): Session {
    const exists = existsSync(path);
    if (!exists && !create) throw new TabulaError("No such file: " + tilde(path));
    if (exists && statSync(path).isDirectory()) throw new TabulaError(tilde(path) + " is a directory");
    const db = new Database(path, { create, readwrite: true, safeIntegers: true });
    try {
      db.query("SELECT count(*) FROM sqlite_schema").get();       // "file is not a database" surfaces here
      db.run("PRAGMA busy_timeout = 4000");                         // wait for other writers instead of failing instantly
      db.run("PRAGMA foreign_keys = ON");
    } catch (e) { db.close(); throw new TabulaError((e as Error).message + " (" + tilde(path) + ")"); }
    return new Session(realpathSync(path), db);
  }

  close() { try { this.db.close(); } catch { /* already closed */ } }

  private pragma(name: string): unknown {
    const row = this.db.query(`PRAGMA ${name}`).get() as Record<string, unknown> | null;
    return row ? enc(Object.values(row)[0]) : null;
  }
  schemaVersion() { return Number(this.pragma("schema_version")); }
  dataVersion() { return Number(this.pragma("data_version")); }

  info() {
    const size = (p: string) => (existsSync(p) ? statSync(p).size : 0);
    const v = this.db.query("SELECT sqlite_version() AS v").get() as { v: string };
    return {
      path: this.path, name: basename(this.path), dir: tilde(dirname(this.path)) + "/", display: tilde(this.path),
      size: size(this.path), wal: size(this.path + "-wal"),
      pageCount: Number(this.pragma("page_count")), pageSize: Number(this.pragma("page_size")), freelist: Number(this.pragma("freelist_count")),
      sqlite: v.v, userVersion: Number(this.pragma("user_version")), journal: String(this.pragma("journal_mode")).toUpperCase(),
      fk: !!Number(this.pragma("foreign_keys")), schemaVersion: this.schemaVersion(), dataVersion: this.dataVersion(),
      inTransaction: this.db.inTransaction,
    };
  }

  schema(): Schema { return introspect(this.db); }

  counts(): Record<string, number | null> {
    const out: Record<string, number | null> = {};
    for (const t of introspect(this.db, false).tables) {
      try { out[t.name] = Number((this.db.query(`SELECT count(*) AS n FROM main.${qi(t.name)}`).get() as { n: bigint }).n); }
      catch { out[t.name] = null; }
    }
    return out;
  }

  rows(table: string, offset = 0, limit = 200) {
    const model = introspect(this.db, false).tables.find(t => t.name === table && t.kind === "table");
    if (!model) throw new TabulaError("no such table: " + table);
    const rowid = !model.withoutRowid;
    const q = this.db.prepare(`SELECT ${rowid ? "rowid AS __tabula_rowid, " : ""}* FROM main.${qi(table)} LIMIT ? OFFSET ?`);
    try {
      let cols = q.columnNames;
      let rows = q.values(Math.min(limit, 1000) + 1, Math.max(0, offset)) as unknown[][];
      const more = rows.length > limit;
      if (more) rows = rows.slice(0, limit);
      let keys: unknown[];
      if (rowid) {
        keys = rows.map(r => ({ rowid: enc(r[0]) }));
        cols = cols.slice(1);
        rows = rows.map(r => r.slice(1));
      } else {
        const pk = model.cols.filter(c => c.pk > 0).sort((a, b) => a.pk - b.pk).map(c => c.name);
        keys = rows.map(r => ({ pk: pk.map(name => [name, enc(r[cols.indexOf(name)])]) }));
      }
      return { table, cols, rows: rows.map(r => r.map(enc)), keys, offset, more };
    } finally { q.finalize(); }
  }

  private tableAndWhere(table: string, key: any) {
    const model = introspect(this.db, false).tables.find(t => t.name === table && t.kind === "table");
    if (!model) throw new TabulaError("no such table: " + table);
    if (key && Object.prototype.hasOwnProperty.call(key, "rowid") && !model.withoutRowid)
      return { model, where: "rowid = ?", values: [key.rowid] };
    const pk = model.cols.filter(c => c.pk > 0).sort((a, b) => a.pk - b.pk);
    const sent = new Map(Array.isArray(key?.pk) ? key.pk : []);
    if (!pk.length || pk.some(c => !sent.has(c.name))) throw new TabulaError("This row has no stable primary key.");
    return { model, where: pk.map(c => qi(c.name) + " IS ?").join(" AND "), values: pk.map(c => sent.get(c.name)) };
  }

  updateCell(table: string, column: string, key: unknown, value: unknown) {
    const k = this.tableAndWhere(table, key);
    if (!k.model.cols.some(c => c.name === column)) throw new TabulaError("no such column: " + table + "." + column);
    const r = this.db.query(`UPDATE main.${qi(table)} SET ${qi(column)} = ? WHERE ${k.where}`).run(value as any, ...k.values as any[]);
    return { changes: Number(r.changes), dataVersion: this.dataVersion() };
  }

  insertDefault(table: string) {
    const model = introspect(this.db, false).tables.find(t => t.name === table && t.kind === "table");
    if (!model) throw new TabulaError("no such table: " + table);
    const r = this.db.query(`INSERT INTO main.${qi(table)} DEFAULT VALUES`).run();
    return { changes: Number(r.changes), dataVersion: this.dataVersion() };
  }

  deleteRow(table: string, key: unknown) {
    const k = this.tableAndWhere(table, key);
    const r = this.db.query(`DELETE FROM main.${qi(table)} WHERE ${k.where}`).run(...k.values as any[]);
    return { changes: Number(r.changes), dataVersion: this.dataVersion() };
  }

  // The SQL console. Runs every statement in the script, in order, for real.
  sql(text: string) {
    const stmts = splitSql(text);
    const sv0 = this.schemaVersion();
    const t0 = performance.now();
    let result: { cols: string[]; rows: unknown[][]; truncated: boolean } | null = null;
    let changes = 0;
    for (let i = 0; i < stmts.length; i++) {
      let q;
      try { q = this.db.prepare(stmts[i].sql); }
      catch (e) { throw this.consoleError(e, i, stmts); }
      try {
        const cols = q.columnNames;
        if (cols.length) {
          const rows: unknown[][] = [];
          let truncated = false;
          if (new Set(cols).size === cols.length) {
            // Stream, so "SELECT * FROM a_huge_table" stops after ROW_CAP rows instead of loading everything.
            for (const r of q.iterate() as Iterable<Record<string, unknown>>) {
              if (rows.length === ROW_CAP) { truncated = true; break; }
              rows.push(cols.map(c => enc(r[c])));
            }
          } else {
            // Duplicate column names (a join with two "id"s) collapse in row objects; fetch arrays instead.
            const all = q.values() as unknown[][];
            truncated = all.length > ROW_CAP;
            for (const r of all.slice(0, ROW_CAP)) rows.push(r.map(enc));
          }
          result = { cols, rows, truncated };
        } else {
          changes += Number(q.run().changes);
        }
      } catch (e) { throw this.consoleError(e, i, stmts); }
      finally { q.finalize(); }
    }
    return {
      statements: stmts.length, result, changes, ms: +(performance.now() - t0).toFixed(2),
      schemaChanged: this.schemaVersion() !== sv0, inTransaction: this.db.inTransaction,
    };
  }

  private consoleError(e: unknown, i: number, stmts: { sql: string }[]) {
    return new TabulaError((e as Error).message, {
      statement: i + 1, of: stmts.length, near: stmts[i].sql.slice(0, 120), inTransaction: this.db.inTransaction,
    });
  }

  // ---------------------------------------------------------------- migrations
  //
  // The browser diffs the canvas against the schema it loaded and sends the
  // resulting ops. This wraps them the way SQLite's own documentation says a
  // schema change must be wrapped:
  //
  //   PRAGMA foreign_keys = OFF      must be outside the transaction, or it's a no-op
  //   BEGIN IMMEDIATE                take the write lock up front
  //     ...ops...                    a REBUILD also re-creates the table's triggers,
  //                                  which SQLite deletes together with the table
  //     every view still compiles?   views aren't checked when their table changes
  //     no NEW foreign key breaks?   compared against the count before we started
  //   PRAGMA user_version = n + 1
  //   COMMIT                         (or ROLLBACK for a dry run / any failure)
  //   PRAGMA foreign_keys = <what it was>

  migrate(ops: Op[], baseSchemaVersion: number | null, commit: boolean) {
    const db = this.db;
    if (db.inTransaction) throw new TabulaError("A transaction is open (from the SQL console). COMMIT or ROLLBACK it first.");
    if (baseSchemaVersion != null && this.schemaVersion() !== baseSchemaVersion)
      throw new TabulaError("The schema changed on disk since Tabula loaded it. Reload, then redo the edit.", { code: "STALE" });

    const fkWas = !!Number(this.pragma("foreign_keys"));
    const uv = Number(this.pragma("user_version"));
    const log: string[] = [];
    let current = -1, currentSql = "";
    const run = (sql: string) => { currentSql = sql; log.push(sql); db.run(sql); };
    const t0 = performance.now();

    db.run("PRAGMA foreign_keys = OFF");
    try {
      const before = this.fkViolations();
      db.run("BEGIN IMMEDIATE");
      for (current = 0; current < ops.length; current++) {
        const op = ops[current];
        if (op.kind === "REBUILD" && op.table) {
          const live = introspect(db, false).tables.find(t => t.name === op.table);
          if (live?.lossy.length) throw new TabulaError(
            `Refusing to rebuild ${op.table}: Tabula cannot safely model ${live.lossy.join(", ")}. Use the SQL console for this migration.`
          );
        }
        // Capture the triggers now, with their current text: earlier ops in this
        // migration may have renamed columns, and SQLite rewrote the trigger bodies.
        const triggers = op.kind === "REBUILD" && op.table
          ? (db.query("SELECT sql FROM main.sqlite_schema WHERE type = 'trigger' AND tbl_name = ? AND sql IS NOT NULL").all(op.table) as { sql: string }[])
          : [];
        for (const st of splitSql(op.sql)) run(st.sql);
        for (const tr of triggers) run(tr.sql);
      }
      current = -1;

      currentSql = "view check";
      for (const v of db.query("SELECT name FROM main.sqlite_schema WHERE type = 'view'").all() as { name: string }[]) {
        try { db.prepare(`SELECT * FROM main.${qi(v.name)} LIMIT 0`).finalize(); }
        catch (e) { throw new TabulaError(`This would break view ${v.name}: ${(e as Error).message}`); }
      }

      currentSql = "foreign key check";
      const after = this.fkViolations();
      const broken = Object.entries(after).filter(([k, n]) => n > (before[k] ?? 0));
      if (broken.length) {
        throw new TabulaError("Foreign key check failed: " + broken.map(([k, n]) => `${k} (${n - (before[k] ?? 0)} row${n - (before[k] ?? 0) === 1 ? "" : "s"})`).join(", ")
          + ". Existing rows don't satisfy the new references.");
      }

      run(`PRAGMA user_version = ${uv + 1}`);
      db.run(commit ? "COMMIT" : "ROLLBACK");
    } catch (e) {
      if (db.inTransaction) db.run("ROLLBACK");
      const extra = e instanceof TabulaError ? e.extra : {};
      throw new TabulaError((e as Error).message, { ...extra, op: current >= 0 ? current : null, statement: currentSql });
    } finally {
      db.run("PRAGMA legacy_alter_table = OFF");
      db.run(`PRAGMA foreign_keys = ${fkWas ? "ON" : "OFF"}`);
    }
    return { statements: log.length, ms: +(performance.now() - t0).toFixed(1), log, committed: commit };
  }

  // "child → parent": number of rows whose reference points nowhere.
  private fkViolations(): Record<string, number> {
    const rows = this.db.query("SELECT \"table\" AS t, parent AS p, count(*) AS n FROM pragma_foreign_key_check GROUP BY 1, 2").all() as { t: string; p: string; n: bigint }[];
    return Object.fromEntries(rows.map(r => [`${r.t} → ${r.p}`, Number(r.n)]));
  }

  // --------------------------------------------------------------- maintenance

  setJournal(mode: string) {
    if (!/^(WAL|DELETE|TRUNCATE|PERSIST|MEMORY|OFF)$/i.test(mode)) throw new TabulaError("unknown journal mode " + mode);
    if (this.db.inTransaction) throw new TabulaError("Can't change journal_mode inside a transaction.");
    const got = String(this.pragma(`journal_mode = ${mode.toUpperCase()}`)).toUpperCase();
    if (got !== mode.toUpperCase()) throw new TabulaError(`SQLite kept journal_mode ${got}`);
  }

  setForeignKeys(on: boolean) {
    if (this.db.inTransaction) throw new TabulaError("foreign_keys can't change inside a transaction.");
    this.db.run(`PRAGMA foreign_keys = ${on ? "ON" : "OFF"}`);
  }

  integrity() {
    const rows = this.db.query("PRAGMA integrity_check(50)").values() as unknown[][];
    const msgs = rows.map(r => String(r[0]));
    return { ok: msgs.length === 1 && msgs[0] === "ok", messages: msgs };
  }

  vacuum() {
    if (this.db.inTransaction) throw new TabulaError("VACUUM can't run inside a transaction.");
    const bytes = () => (existsSync(this.path) ? statSync(this.path).size : 0) + (existsSync(this.path + "-wal") ? statSync(this.path + "-wal").size : 0);
    const before = bytes();
    const t0 = performance.now();
    this.db.run("VACUUM");
    if (String(this.pragma("journal_mode")).toLowerCase() === "wal") this.db.query("PRAGMA wal_checkpoint(TRUNCATE)").get();
    return { before, after: bytes(), ms: +(performance.now() - t0).toFixed(0) };
  }
}
