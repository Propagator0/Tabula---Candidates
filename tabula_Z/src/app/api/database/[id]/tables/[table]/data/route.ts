import { NextResponse } from "next/server";
import {
  getTableData,
  getTableSchema,
  quoteIdent,
  isSafeIdent,
  executeScript,
} from "@/lib/sqlite";
import { resolveManagedDatabase, errorResponse } from "@/lib/api-helpers";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; table: string }> }
) {
  const { id, table } = await params;
  try {
    const { sqlite } = await resolveManagedDatabase(id);
    const name = decodeURIComponent(table);
    if (!isSafeIdent(name)) return errorResponse(new Error("Invalid table name"));
    const url = new URL(req.url);
    const limit = Number(url.searchParams.get("limit") || "50");
    const offset = Number(url.searchParams.get("offset") || "0");
    const orderColumn = url.searchParams.get("orderColumn") || undefined;
    const orderDir = (url.searchParams.get("orderDir") || "ASC") as "ASC" | "DESC";
    const where = url.searchParams.get("where") || undefined;

    const schema = getTableSchema(sqlite, name);
    const { rows, total } = getTableData(sqlite, name, {
      limit,
      offset,
      orderColumn: orderColumn || undefined,
      orderDir,
      where: where || undefined,
    });
    return NextResponse.json({
      rows,
      total,
      columns: schema.columns,
      limit,
      offset,
    });
  } catch (e) {
    return errorResponse(e);
  }
}

/** INSERT a new row. Body: { row: Record<string, unknown> } */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; table: string }> }
) {
  const { id, table } = await params;
  try {
    const { sqlite } = await resolveManagedDatabase(id);
    const name = decodeURIComponent(table);
    if (!isSafeIdent(name)) return errorResponse(new Error("Invalid table name"));
    const body = (await req.json()) as { row: Record<string, unknown> };
    const cols = Object.keys(body.row).filter((c) => isSafeIdent(c));
    if (cols.length === 0) return errorResponse(new Error("No columns provided"));
    const placeholders = cols.map(() => "?").join(", ");
    const colList = cols.map((c) => quoteIdent(c)).join(", ");
    const values = cols.map((c) => body.row[c]);
    const sql = `INSERT INTO ${quoteIdent(name)} (${colList}) VALUES (${placeholders});`;
    const insert = sqlite.prepare(sql);
    const info = insert.run(...values);
    return NextResponse.json({
      ok: true,
      lastInsertRowid: Number(info.lastInsertRowid),
      changes: info.changes,
    });
  } catch (e) {
    return errorResponse(e);
  }
}

/** UPDATE rows matching a primary-key predicate.
 *  Body: { pkColumn, pkValue, row: Partial<Record<string, unknown>> }
 */
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string; table: string }> }
) {
  const { id, table } = await params;
  try {
    const { sqlite } = await resolveManagedDatabase(id);
    const name = decodeURIComponent(table);
    if (!isSafeIdent(name)) return errorResponse(new Error("Invalid table name"));
    const body = (await req.json()) as {
      pkColumn: string;
      pkValue: unknown;
      row: Record<string, unknown>;
    };
    if (!isSafeIdent(body.pkColumn)) {
      return errorResponse(new Error("Invalid primary key column"));
    }
    const cols = Object.keys(body.row).filter(
      (c) => c !== body.pkColumn && isSafeIdent(c)
    );
    if (cols.length === 0) return errorResponse(new Error("No updatable columns"));
    const setClause = cols.map((c) => `${quoteIdent(c)} = ?`).join(", ");
    const values = cols.map((c) => body.row[c]);
    const sql = `UPDATE ${quoteIdent(name)} SET ${setClause} WHERE ${quoteIdent(body.pkColumn)} = ?;`;
    const info = sqlite.prepare(sql).run(...values, body.pkValue);
    return NextResponse.json({ ok: true, changes: info.changes });
  } catch (e) {
    return errorResponse(e);
  }
}

/** DELETE a row by primary key. Body: { pkColumn, pkValue } */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; table: string }> }
) {
  const { id, table } = await params;
  try {
    const { sqlite } = await resolveManagedDatabase(id);
    const name = decodeURIComponent(table);
    if (!isSafeIdent(name)) return errorResponse(new Error("Invalid table name"));
    const body = (await req.json()) as { pkColumn: string; pkValue: unknown };
    if (!isSafeIdent(body.pkColumn)) {
      return errorResponse(new Error("Invalid primary key column"));
    }
    const sql = `DELETE FROM ${quoteIdent(name)} WHERE ${quoteIdent(body.pkColumn)} = ?;`;
    const info = sqlite.prepare(sql).run(body.pkValue);
    return NextResponse.json({ ok: true, changes: info.changes });
  } catch (e) {
    return errorResponse(e);
  }
}

// Keep executeScript import used (referenced indirectly via type only above).
void executeScript;
