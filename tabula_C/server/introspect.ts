// Reads the live schema of a SQLite database into the shape the canvas uses.
//
// The canvas model is deliberately small: name, type, PK, NOT NULL, UNIQUE,
// DEFAULT, one-column foreign keys, AUTOINCREMENT, STRICT, WITHOUT ROWID,
// plain indexes. Real databases can hold more (CHECK, COLLATE, generated
// columns...). Anything the model can't express goes into `lossy` for that
// table. The browser refuses to REBUILD a lossy table, because a rebuild
// recreates the table from the model and would silently delete those parts.
// Renames, ADD COLUMN and DROP COLUMN are still fine: SQLite performs those
// itself and keeps everything.

import type { Database } from "bun:sqlite";
import { bareWords } from "./sqlsplit";

export type Fk = { table: string; col: string | null; onDelete: string; onUpdate: string };
export type Col = { name: string; type: string; pk: number; nn: boolean; uq: boolean; def: string | null; ai: boolean; fk: Fk | null };
export type Idx = { name: string; unique: boolean; cols: string[]; raw: string | null };
export type Table = {
  name: string; kind: "table" | "virtual"; strict: boolean; withoutRowid: boolean;
  count: number | null; sql: string; cols: Col[]; indexes: Idx[]; lossy: string[];
};
export type Schema = {
  tables: Table[];
  views: { name: string; sql: string }[];
  triggers: { name: string; table: string; sql: string }[];
};

export const qi = (name: string) => '"' + name.replace(/"/g, '""') + '"';

// The connection runs with safeIntegers (so 64-bit ids in YOUR data stay
// exact). PRAGMA results are small counters and flags, so turn them back
// into plain numbers here.
function all<T = any>(db: Database, sql: string, ...args: any[]): T[] {
  return (db.query(sql).all(...args) as Record<string, unknown>[])
    .map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === "bigint" ? Number(v) : v])) as T);
}

export function introspect(db: Database, withCounts = true): Schema {
  const master = all<{ type: string; name: string; tbl_name: string; sql: string | null }>(db, "SELECT type, name, tbl_name, sql FROM main.sqlite_schema");
  const sqlOf = (type: string, name: string) => master.find(m => m.type === type && m.name === name)?.sql ?? "";

  const list = all<{ name: string; type: string; wr: number; strict: number }>(db, "SELECT name, type, wr, strict FROM pragma_table_list WHERE schema = 'main'")
    .filter(t => (t.type === "table" || t.type === "virtual") && !t.name.startsWith("sqlite_"))
    .sort((a, b) => master.findIndex(m => m.name === a.name) - master.findIndex(m => m.name === b.name));   // creation order

  const tables: Table[] = list.map(t => readTable(db, t, sqlOf("table", t.name), sqlOf));

  // Foreign keys that omit the parent column ("REFERENCES users") point at the
  // parent's primary key. Resolve them now that every table is loaded.
  const byName = new Map(tables.map(t => [t.name.toLowerCase(), t]));
  for (const t of tables) for (const c of t.cols) {
    if (!c.fk) continue;
    const parent = byName.get(c.fk.table.toLowerCase());
    if (!parent) { t.lossy.push(`foreign key ${c.name} → missing table ${c.fk.table}`); c.fk = null; continue; }
    c.fk.table = parent.name;
    if (c.fk.col == null) {
      const pks = parent.cols.filter(x => x.pk > 0);
      if (pks.length === 1) c.fk.col = pks[0].name;
      else { t.lossy.push(`foreign key ${c.name} → ${parent.name} (implicit composite key)`); c.fk = null; continue; }
    }
    const target = parent.cols.find(x => x.name.toLowerCase() === c.fk!.col!.toLowerCase());
    if (!target) { t.lossy.push(`foreign key ${c.name} → missing column ${parent.name}.${c.fk.col}`); c.fk = null; continue; }
    c.fk.col = target.name;
  }

  if (withCounts) for (const t of tables) {
    try { t.count = Number((db.query(`SELECT count(*) AS n FROM main.${qi(t.name)}`).get() as { n: number | bigint }).n); }
    catch { t.count = null; }
  }

  return {
    tables,
    views: master.filter(m => m.type === "view").map(m => ({ name: m.name, sql: m.sql ?? "" })),
    triggers: master.filter(m => m.type === "trigger").map(m => ({ name: m.name, table: m.tbl_name, sql: m.sql ?? "" })),
  };
}

function readTable(
  db: Database,
  t: { name: string; type: string; wr: number; strict: number },
  sql: string,
  sqlOf: (type: string, name: string) => string,
): Table {
  const lossy: string[] = [];
  const virtual = t.type === "virtual";
  if (virtual) lossy.push("virtual table (" + (sql.match(/USING\s+(\w+)/i)?.[1] ?? "module") + ")");

  const xinfo = all<{ cid: number; name: string; type: string; nn: number; def: string | null; pk: number; hidden: number }>(db,
    "SELECT cid, name, type, \"notnull\" AS nn, dflt_value AS def, pk, hidden FROM pragma_table_xinfo(?, 'main')", t.name);
  const visible = xinfo.filter(c => c.hidden !== 1);                 // 1 = hidden column of a virtual table
  if (visible.some(c => c.hidden === 2 || c.hidden === 3)) lossy.push("generated column");

  const words = new Set(bareWords(sql));
  if (!virtual) {
    if (words.has("CHECK")) lossy.push("CHECK constraint");
    if (words.has("COLLATE")) lossy.push("COLLATE");
    if (words.has("GENERATED") && !lossy.includes("generated column")) lossy.push("generated column");
    if (words.has("DEFERRABLE")) lossy.push("DEFERRABLE foreign key");
    if (words.has("CONFLICT")) lossy.push("ON CONFLICT clause");
    if (words.has("DESC")) lossy.push("descending PRIMARY KEY");
  }

  const cols: Col[] = visible.map(c => ({
    name: c.name, type: c.type ?? "", pk: c.pk, nn: !!c.nn, uq: false, def: c.def, ai: false, fk: null,
  }));

  // Composite primary keys are modelled in column order. If the key was
  // declared in a different order, a rebuild would change it.
  const pkCols = cols.filter(c => c.pk > 0);
  const pkOrder = [...pkCols].sort((a, b) => a.pk - b.pk).map(c => c.name).join();
  if (pkCols.map(c => c.name).join() !== pkOrder) lossy.push("PRIMARY KEY column order");
  if (words.has("AUTOINCREMENT") && pkCols.length === 1) pkCols[0].ai = true;

  // Foreign keys: only single-column ones fit the model.
  const fkRows = all<{ id: number; seq: number; parent: string; src: string; dst: string | null; on_update: string; on_delete: string }>(db,
    "SELECT id, seq, \"table\" AS parent, \"from\" AS src, \"to\" AS dst, on_update, on_delete FROM pragma_foreign_key_list(?, 'main')", t.name);
  const groups = new Map<number, typeof fkRows>();
  for (const r of fkRows) groups.set(r.id, [...(groups.get(r.id) ?? []), r]);
  for (const g of groups.values()) {
    if (g.length > 1) { lossy.push(`composite foreign key (${g.map(r => r.src).join(", ")})`); continue; }
    const col = cols.find(c => c.name.toLowerCase() === g[0].src.toLowerCase());
    if (!col) continue;
    if (col.fk) { lossy.push(`second foreign key on ${col.name}`); continue; }
    col.fk = { table: g[0].parent, col: g[0].dst, onDelete: g[0].on_delete, onUpdate: g[0].on_update };
  }

  // Indexes. origin: 'pk' = primary key, 'u' = UNIQUE constraint, 'c' = CREATE INDEX.
  const indexes: Idx[] = [];
  const idxList = all<{ name: string; uniq: number; origin: string; partial: number }>(db,
    "SELECT name, \"unique\" AS uniq, origin, partial FROM pragma_index_list(?, 'main')", t.name);
  for (const ix of idxList.reverse()) {                              // index_list is newest-first
    if (ix.origin === "pk") continue;
    const keys = all<{ cid: number; name: string | null; d: number; coll: string | null }>(db,
      "SELECT cid, name, \"desc\" AS d, coll FROM pragma_index_xinfo(?, 'main') WHERE key = 1 ORDER BY seqno", ix.name);
    const plain = !ix.partial && keys.every(k => k.cid >= 0 && !k.d && (k.coll ?? "BINARY").toUpperCase() === "BINARY");
    if (ix.origin === "u") {
      if (keys.length === 1 && plain) {
        const col = cols.find(c => c.name === keys[0].name);
        if (col) col.uq = true;
      } else lossy.push(`multi-column UNIQUE (${keys.map(k => k.name ?? "expr").join(", ")})`);
      continue;
    }
    indexes.push({
      name: ix.name, unique: !!ix.uniq,
      cols: keys.map(k => k.name).filter((x): x is string => !!x),
      raw: plain ? null : sqlOf("index", ix.name),                 // partial / expression / DESC / COLLATE index: keep its SQL verbatim
    });
  }
  const rawIdx = indexes.filter(i => i.raw).map(i => i.name);
  if (rawIdx.length) lossy.push("partial or expression index " + rawIdx.join(", "));

  return { name: t.name, kind: virtual ? "virtual" : "table", strict: !!t.strict, withoutRowid: !!t.wr, count: null, sql, cols, indexes, lossy };
}
