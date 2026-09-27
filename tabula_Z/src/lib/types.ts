/** Shared types mirrored from the backend SQLite layer. */

export interface ColumnInfo {
  cid: number;
  name: string;
  type: string;
  notNull: number;
  dfltValue: string | null;
  pk: number;
  autoincrement?: boolean;
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

export interface ManagedDatabase {
  id: string;
  name: string;
  filePath: string;
  color: string;
  fileSize: number;
  createdAt: string;
  lastOpenedAt: string | null;
  tableCount: number | null;
  reachable: boolean;
  _count?: { queryHistory: number };
}

export interface TableLayout {
  id?: string;
  databaseId?: string;
  tableName: string;
  x: number;
  y: number;
  note?: string | null;
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
  databaseName?: string;
}

export interface QueryHistoryItem {
  id: string;
  databaseId: string;
  query: string;
  success: boolean;
  rowCount: number;
  durationMs: number;
  error: string | null;
  executedAt: string;
}

export type TabType = "er" | "design" | "data" | "query" | "schema" | "history" | "overview";

export interface Tab {
  id: string;
  type: TabType;
  title: string;
  table?: string;
  closable: boolean;
}

/** Normalise an arbitrary SQLite type string into a canonical family. */
export function typeFamily(type: string): "integer" | "text" | "real" | "blob" | "other" {
  const t = (type || "").toUpperCase();
  if (t.includes("INT")) return "integer";
  if (t.includes("CHAR") || t.includes("CLOB") || t.includes("TEXT")) return "text";
  if (t.includes("BLOB") || t === "") return "blob";
  if (t.includes("REAL") || t.includes("FLOA") || t.includes("DOUB")) return "real";
  return "other";
}

export function typeTintClass(type: string): string {
  switch (typeFamily(type)) {
    case "integer":
      return "chip-integer";
    case "text":
      return "chip-text";
    case "real":
      return "chip-real";
    case "blob":
      return "chip-blob";
    default:
      return "bg-muted text-muted-foreground";
  }
}

export function typeTextClass(type: string): string {
  switch (typeFamily(type)) {
    case "integer":
      return "tint-integer";
    case "text":
      return "tint-text";
    case "real":
      return "tint-real";
    case "blob":
      return "tint-blob";
    default:
      return "text-muted-foreground";
  }
}
