import { NextResponse } from "next/server";
import {
  getTableSchema,
  quoteIdent,
  executeScript,
  isSafeIdent,
} from "@/lib/sqlite";
import { resolveManagedDatabase, errorResponse } from "@/lib/api-helpers";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; table: string }> }
) {
  const { id, table } = await params;
  try {
    const { sqlite } = await resolveManagedDatabase(id);
    const schema = getTableSchema(sqlite, decodeURIComponent(table));
    return NextResponse.json({ table: schema });
  } catch (e) {
    return errorResponse(e);
  }
}

/** DELETE drops the table (or view). */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; table: string }> }
) {
  const { id, table } = await params;
  try {
    const { sqlite } = await resolveManagedDatabase(id);
    const name = decodeURIComponent(table);
    if (!isSafeIdent(name)) return errorResponse(new Error("Invalid table name"));
    const obj = sqlite
      .prepare("SELECT type FROM sqlite_master WHERE name = ?")
      .get(name) as { type: string } | undefined;
    const kind = obj?.type === "view" ? "VIEW" : "TABLE";
    const result = executeScript(sqlite, `DROP ${kind} IF EXISTS ${quoteIdent(name)};`);
    if (!result.ok) {
      const err = result.statements.find((s) => s.error);
      return NextResponse.json(
        { error: err?.error || "Failed to drop table" },
        { status: 400 }
      );
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}

/** PATCH renames a table or truncates it (action=query: rename|truncate|empty). */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; table: string }> }
) {
  const { id, table } = await params;
  try {
    const { sqlite } = await resolveManagedDatabase(id);
    const name = decodeURIComponent(table);
    if (!isSafeIdent(name)) return errorResponse(new Error("Invalid table name"));
    const body = (await req.json()) as { action: "rename" | "truncate"; newName?: string };
    let sql = "";
    if (body.action === "rename") {
      if (!body.newName || !isSafeIdent(body.newName)) {
        return errorResponse(new Error("Invalid new table name"));
      }
      sql = `ALTER TABLE ${quoteIdent(name)} RENAME TO ${quoteIdent(body.newName)};`;
    } else if (body.action === "truncate") {
      sql = `DELETE FROM ${quoteIdent(name)};`;
    } else {
      return errorResponse(new Error("Unknown action"));
    }
    const result = executeScript(sqlite, sql);
    if (!result.ok) {
      const err = result.statements.find((s) => s.error);
      return NextResponse.json(
        { error: err?.error || "Operation failed" },
        { status: 400 }
      );
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
