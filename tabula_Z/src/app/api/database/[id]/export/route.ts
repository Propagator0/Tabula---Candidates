import { NextResponse } from "next/server";
import { getDatabaseSchema, quoteIdent } from "@/lib/sqlite";
import { resolveManagedDatabase, errorResponse } from "@/lib/api-helpers";

/**
 * GET /api/databases/[id]/export
 * Returns the full DDL script (schema dump) for the database, optionally
 * including or excluding data (INSERT statements). Query params:
 *   - format: "sql" (default) | "json"
 *   - includeData: "1" to include INSERT statements for each table
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const { record, sqlite } = await resolveManagedDatabase(id);
    const url = new URL(req.url);
    const format = url.searchParams.get("format") || "sql";
    const includeData = url.searchParams.get("includeData") === "1";

    const schema = getDatabaseSchema(sqlite);

    if (format === "json") {
      return NextResponse.json({
        database: record.name,
        filePath: record.filePath,
        schema,
      });
    }

    // Build a SQL dump.
    const lines: string[] = [];
    lines.push(`-- Tabula schema dump`);
    lines.push(`-- Database: ${record.name}`);
    lines.push(`-- File: ${record.filePath}`);
    lines.push(`-- Generated: ${new Date().toISOString()}`);
    lines.push(`PRAGMA foreign_keys=OFF;`);
    lines.push(`BEGIN TRANSACTION;`);
    lines.push("");

    // Tables (in dependency-friendly order: drop refs first if reversing,
    // but CREATE order from sqlite_master is fine for fresh DBs).
    for (const t of schema.tables) {
      lines.push(`-- Table: ${t.name} (${t.rowCount} rows)`);
      lines.push(`DROP TABLE IF EXISTS ${quoteIdent(t.name)};`);
      lines.push(t.sql + ";");
      lines.push("");
    }

    // Views
    for (const v of schema.views) {
      lines.push(`-- View: ${v.name}`);
      lines.push(`DROP VIEW IF EXISTS ${quoteIdent(v.name)};`);
      lines.push(v.sql + ";");
      lines.push("");
    }

    // Triggers
    for (const tr of schema.triggers) {
      lines.push(`-- Trigger: ${tr.name} on ${tr.table}`);
      lines.push(`DROP TRIGGER IF EXISTS ${quoteIdent(tr.name)};`);
      lines.push(tr.sql + ";");
      lines.push("");
    }

    // Indexes (already part of CREATE TABLE for implicit ones; explicit ones
    // come from sqlite_master with sql populated — but we already included
    // them via the table dump's sql. Skip duplicates here.)

    // Data
    if (includeData) {
      for (const t of schema.tables) {
        if (t.rowCount === 0) continue;
        const rows = sqlite.prepare(`SELECT * FROM ${quoteIdent(t.name)}`).all() as Record<string, unknown>[];
        const cols = t.columns.map((c) => c.name);
        lines.push(`-- Data for ${t.name}`);
        for (const row of rows) {
          const vals = cols.map((c) => serializeValue(row[c]));
          const colList = cols.map((c) => quoteIdent(c)).join(", ");
          lines.push(`INSERT INTO ${quoteIdent(t.name)} (${colList}) VALUES (${vals.join(", ")});`);
        }
        lines.push("");
      }
    }

    lines.push("COMMIT;");
    lines.push("");
    lines.push(`PRAGMA foreign_keys=ON;`);

    const dump = lines.join("\n");
    const filename = `${record.name.replace(/[^a-z0-9_-]/gi, "_")}.sql`;

    return new Response(dump, {
      headers: {
        "Content-Type": "application/sql; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}

function serializeValue(v: unknown): string {
  if (v == null) return "NULL";
  if (typeof v === "number") return String(v);
  if (typeof v === "bigint") return String(v);
  if (typeof v === "boolean") return v ? "1" : "0";
  if (Buffer.isBuffer(v)) return `X'${v.toString("hex")}'`;
  // string — escape single quotes
  return `'${String(v).replace(/'/g, "''")}'`;
}
