import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

/**
 * Core SQLite operations layer built on better-sqlite3.
 * Manages a cache of open Database connections keyed by absolute file path,
 * and exposes introspection + execution helpers used across the API routes.
 */

export type SqliteType =
  | "INTEGER"
  | "TEXT"
  | "REAL"
  | "BLOB"
  | "NUMERIC"
  | string;

export interface ColumnInfo {
  cid: number;
  name: string;
  type: string;
  notNull: number;
  dfltValue: string | null;
  pk: number;
  /** Derived: whether the column is declared AUTOINCREMENT. */
  autoincrement?: boolean;
  /** Derived: foreign key target if present. */
  fk?: { table: string; column: string } | null;
}

export interface ForeignKeyInfo {
  id: number;
  seq: number;
  table: string;
  from: string;
  to: string;
  onUpdate: string;
  onDelete: string;
  match: string;
}

export interface IndexInfo {
  seq: number;
  name: string;
  unique: number;
  origin: string;
  partial: number;
  columns: string[];
}

export interface TableSchema {
  name: string;
  type: "table" | "view";
  sql: string;
  rowCount: number;
  columns: ColumnInfo[];
  foreignKeys: ForeignKeyInfo[];
  indexes: IndexInfo[];
}

export interface DatabaseSchema {
  tables: TableSchema[];
  views: { name: string; sql: string }[];
  triggers: { name: string; sql: string; table: string; event: string }[];
  pragmas: { name: string; value: string }[];
}

const connections = new Map<string, Database.Database>();

/**
 * Open (or return a cached) read-write connection to a SQLite file.
 * Creates the file if it does not yet exist.
 */
export function openDatabase(filePath: string): Database.Database {
  const abs = path.resolve(filePath);
  let db = connections.get(abs);
  if (db) return db;

  // Ensure parent directory exists for brand new databases.
  const dir = path.dirname(abs);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  db = new Database(abs);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  connections.set(abs, db);
  return db;
}

/** Close & remove a connection from the cache. */
export function closeDatabase(filePath: string) {
  const abs = path.resolve(filePath);
  const db = connections.get(abs);
  if (db) {
    db.close();
    connections.delete(abs);
  }
}

/** Validate that a file is a reachable SQLite database (or create it). */
export function validateDatabaseFile(filePath: string): {
  ok: boolean;
  exists: boolean;
  error?: string;
} {
  try {
    const abs = path.resolve(filePath);
    const exists = fs.existsSync(abs);
    if (exists) {
      // Quick magic-header check.
      const fd = fs.openSync(abs, "r");
      const buf = Buffer.alloc(16);
      fs.readSync(fd, buf, 0, 16, 0);
      fs.closeSync(fd);
      const header = buf.toString("utf8", 0, 15);
      if (header !== "SQLite format 3\0") {
        return { ok: false, exists, error: "File is not a valid SQLite database" };
      }
    }
    return { ok: true, exists };
  } catch (e) {
    return { ok: false, exists: false, error: (e as Error).message };
  }
}

/** List all tables & views in the database. */
export function listTables(db: Database.Database): { name: string; type: "table" | "view" }[] {
  const rows = db
    .prepare(
      "SELECT name, type FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY type, name"
    )
    .all() as { name: string; type: "table" | "view" }[];
  return rows;
}

/** Introspect the full schema of a single table (or view). */
export function getTableSchema(db: Database.Database, tableName: string): TableSchema {
  const info = db
    .prepare("SELECT name, type, sql FROM sqlite_master WHERE name = ?")
    .get(tableName) as { name: string; type: "table" | "view"; sql: string };

  if (!info) throw new Error(`Table "${tableName}" not found`);

  const columns = db.prepare(`PRAGMA table_info(${quoteIdent(tableName)})`).all() as ColumnInfo[];
  const foreignKeys = db
    .prepare(`PRAGMA foreign_key_list(${quoteIdent(tableName)})`)
    .all() as ForeignKeyInfo[];
  const indexRows = db
    .prepare(`PRAGMA index_list(${quoteIdent(tableName)})`)
    .all() as {
    seq: number;
    name: string;
    unique: number;
    origin: string;
    partial: number;
  }[];

  const indexes: IndexInfo[] = indexRows.map((i) => {
    const cols = db
      .prepare(`PRAGMA index_info(${quoteIdent(i.name)})`)
      .all() as { seqno: number; cid: number; name: string }[];
    return { ...i, columns: cols.map((c) => c.name) };
  });

  // Attach fk info onto columns. AUTOINCREMENT only applies to the PK column.
  const tableHasAutoincrement = /autoincrement/i.test(info.sql || "");
  for (const col of columns) {
    const fk = foreignKeys.find((f) => f.from === col.name);
    col.fk = fk ? { table: fk.table, column: fk.to } : null;
    col.autoincrement = col.pk === 1 && tableHasAutoincrement;
    // A column is UNIQUE if it's the sole column of a unique index (origin 'u').
    const uniqueIdx = indexes.find(
      (idx) => idx.unique === 1 && idx.origin === "u" && idx.columns.length === 1 && idx.columns[0] === col.name
    );
    (col as ColumnInfo & { unique?: boolean }).unique = !!uniqueIdx;
  }

  let rowCount = 0;
  if (info.type === "table") {
    try {
      rowCount = (
        db.prepare(`SELECT COUNT(*) as c FROM ${quoteIdent(tableName)}`).get() as { c: number }
      ).c;
    } catch {
      rowCount = 0;
    }
  }

  return {
    name: info.name,
    type: info.type,
    sql: info.sql,
    rowCount,
    columns,
    foreignKeys,
    indexes,
  };
}

/** Introspect the entire database. */
export function getDatabaseSchema(db: Database.Database): DatabaseSchema {
  const objects = db
    .prepare(
      "SELECT name, type, sql, tbl_name FROM sqlite_master WHERE type IN ('table','view','trigger') AND name NOT LIKE 'sqlite_%' ORDER BY type, name"
    )
    .all() as { name: string; type: string; sql: string; tbl_name: string }[];

  const tables: TableSchema[] = [];
  const views: { name: string; sql: string }[] = [];
  const triggers: { name: string; sql: string; table: string; event: string }[] = [];

  for (const obj of objects) {
    if (obj.type === "table") {
      tables.push(getTableSchema(db, obj.name));
    } else if (obj.type === "view") {
      views.push({ name: obj.name, sql: obj.sql });
    } else if (obj.type === "trigger") {
      const event = /before/i.test(obj.sql)
        ? "BEFORE"
        : /after/i.test(obj.sql)
          ? "AFTER"
          : /instead of/i.test(obj.sql)
            ? "INSTEAD OF"
            : "UNKNOWN";
      triggers.push({ name: obj.name, sql: obj.sql, table: obj.tbl_name, event });
    }
  }

  const pragmaNames = [
    "encoding",
    "journal_mode",
    "page_size",
    "page_count",
    "foreign_keys",
    "user_version",
    "application_id",
    "auto_vacuum",
  ];
  const pragmas = pragmaNames
    .map((name) => {
      try {
        const row = db.prepare(`PRAGMA ${name}`).get() as Record<string, unknown> | undefined;
        const value = row ? String(Object.values(row)[0]) : "";
        return { name, value };
      } catch {
        return { name, value: "" };
      }
    })
    .filter((p) => p.value !== "");

  return { tables, views, triggers, pragmas };
}

/** Fetch a paginated slice of rows from a table, with optional column ordering. */
export function getTableData(
  db: Database.Database,
  tableName: string,
  opts: { limit?: number; offset?: number; orderColumn?: string; orderDir?: "ASC" | "DESC"; where?: string } = {}
): { rows: Record<string, unknown>[]; total: number } {
  const limit = Math.min(opts.limit ?? 50, 500);
  const offset = Math.max(opts.offset ?? 0, 0);
  const orderCol = opts.orderColumn && isSafeIdent(opts.orderColumn) ? opts.orderColumn : null;
  const orderDir = opts.orderDir === "DESC" ? "DESC" : "ASC";

  let whereSql = "";
  const params: unknown[] = [];
  if (opts.where && opts.where.trim()) {
    // Treat where as a raw SQL fragment (the UI sends sanitized input); wrap in parentheses.
    whereSql = `WHERE (${opts.where})`;
  }

  const total = (
    db
      .prepare(`SELECT COUNT(*) as c FROM ${quoteIdent(tableName)} ${whereSql}`)
      .get(...params) as { c: number }
  ).c;

  const orderSql = orderCol ? `ORDER BY ${quoteIdent(orderCol)} ${orderDir}` : "";
  const rows = db
    .prepare(
      `SELECT * FROM ${quoteIdent(tableName)} ${whereSql} ${orderSql} LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset) as Record<string, unknown>[];

  return { rows, total };
}

export interface ExecutedStatement {
  sql: string;
  type: "select" | "modify" | "other";
  rows?: Record<string, unknown>[];
  columns?: string[];
  changes?: number;
  durationMs: number;
  error?: string;
}

export interface QueryResult {
  statements: ExecutedStatement[];
  totalDurationMs: number;
  ok: boolean;
}

/**
 * Execute a SQL script that may contain multiple statements.
 * Statements are split with a tokenizer that respects string literals,
 * comments and BEGIN...END blocks, then run individually so we can
 * report per-statement results.
 */
export function executeScript(db: Database.Database, sql: string): QueryResult {
  const statements = splitSql(sql);
  const results: ExecutedStatement[] = [];
  let totalDurationMs = 0;
  let ok = true;

  for (const stmt of statements) {
    const trimmed = stmt.trim();
    if (!trimmed) continue;
    const start = performance.now();
    const lower = trimmed.replace(/^\s+/, "").toLowerCase();
    try {
      if (lower.startsWith("select") || lower.startsWith("with") || lower.startsWith("pragma") && !/(insert|update|delete|create|drop|alter)/i.test(lower)) {
        const stmt2 = db.prepare(trimmed);
        const rows = stmt2.all() as Record<string, unknown>[];
        const columns = stmt2.columns().map((c) => c.name);
        const durationMs = Math.round(performance.now() - start);
        totalDurationMs += durationMs;
        results.push({ sql: trimmed, type: "select", rows, columns, durationMs });
      } else {
        const r = db.exec(trimmed);
        const durationMs = Math.round(performance.now() - start);
        totalDurationMs += durationMs;
        results.push({ sql: trimmed, type: "modify", changes: r.changes, durationMs });
      }
    } catch (e) {
      const durationMs = Math.round(performance.now() - start);
      totalDurationMs += durationMs;
      ok = false;
      results.push({ sql: trimmed, type: "other", durationMs, error: (e as Error).message });
      break;
    }
  }

  return { statements: results, totalDurationMs, ok };
}

/**
 * Tokenizer-based SQL splitter. Handles:
 *  - Single-line comments (-- ...)
 *  - Block comments (/* ... *\/)
 *  - Single and double quoted string literals (with '' / "" escapes)
 *  - BEGIN ... END compound blocks (triggers / DDL)
 *  - semicolon terminators outside of the above
 */
export function splitSql(input: string): string[] {
  const out: string[] = [];
  let buf = "";
  let i = 0;
  const n = input.length;

  const isIdent = (c: string) => /[A-Za-z0-9_]/.test(c);

  while (i < n) {
    const c = input[i];
    const two = input.slice(i, i + 2);

    // Line comment
    if (two === "--") {
      while (i < n && input[i] !== "\n") { buf += input[i]; i++; }
      continue;
    }
    // Block comment
    if (two === "/*") {
      buf += two;
      i += 2;
      while (i < n && input.slice(i, i + 2) !== "*/") { buf += input[i]; i++; }
      if (i < n) {
        buf += "*/";
        i += 2;
      }
      continue;
    }
    // Single-quoted string
    if (c === "'") {
      buf += c;
      i++;
      while (i < n) {
        buf += input[i];
        if (input[i] === "'" && input[i + 1] !== "'") {
          i++;
          break;
        }
        if (input[i] === "'" && input[i + 1] === "'") {
          buf += input[i + 1];
          i += 2;
          continue;
        }
        i++;
      }
      continue;
    }
    // Double-quoted / backtick identifier
    if (c === '"' || c === "`") {
      const quote = c;
      buf += c;
      i++;
      while (i < n) {
        buf += input[i];
        if (input[i] === quote && input[i + 1] !== quote) {
          i++;
          break;
        }
        if (input[i] === quote && input[i + 1] === quote) {
          buf += input[i + 1];
          i += 2;
          continue;
        }
        i++;
      }
      continue;
    }

    // BEGIN ... END compound block — swallow up to matching END
    if (isIdent(c) && /begin$/i.test(buf.split(/\s+/).slice(-1)[0] || "")) {
      // handled below: just copy char
    }
    if (/\bbegin\b$/i.test(buf) || /\bbegin\b\s*$/i.test(buf)) {
      // We need to find matching END. Copy until we hit END (case-insensitive) followed by ; or whitespace
      // Simpler approach: count BEGIN/END nesting.
      buf += c;
      i++;
      let depth = 1;
      while (i < n && depth > 0) {
        const ch = input[i];
        // skip strings/comments inside block
        if (input.slice(i, i + 2) === "--") {
          while (i < n && input[i] !== "\n") { buf += input[i]; i++; }
          continue;
        }
        if (input.slice(i, i + 2) === "/*") {
          buf += "/*";
          i += 2;
          while (i < n && input.slice(i, i + 2) !== "*/") { buf += input[i]; i++; }
          if (i < n) {
            buf += "*/";
            i += 2;
          }
          continue;
        }
        if (ch === "'") {
          buf += ch;
          i++;
          while (i < n) {
            buf += input[i];
            if (input[i] === "'" && input[i + 1] !== "'") {
              i++;
              break;
            }
            if (input[i] === "'" && input[i + 1] === "'") {
              buf += input[i + 1];
              i += 2;
              continue;
            }
            i++;
          }
          continue;
        }
        // check word boundaries
        if (isIdent(ch) || /\s/.test(ch)) {
          // gather a word
          let word = "";
          if (isIdent(ch)) {
            while (i < n && isIdent(input[i])) {
              word += input[i];
              buf += input[i];
              i++;
            }
            const lw = word.toLowerCase();
            if (lw === "begin") depth++;
            else if (lw === "end") {
              depth--;
              if (depth === 0) break;
            }
            continue;
          } else {
            buf += ch;
            i++;
            continue;
          }
        }
        buf += ch;
        i++;
      }
      continue;
    }

    // Statement terminator
    if (c === ";") {
      buf += c;
      i++;
      out.push(buf);
      buf = "";
      continue;
    }

    buf += c;
    i++;
  }

  if (buf.trim()) out.push(buf);
  return out;
}

/** Quote a SQL identifier safely. */
export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** Loose check that an identifier is safe to inline. */
export function isSafeIdent(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}
