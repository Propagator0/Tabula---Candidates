import { NextResponse } from "next/server";
import { executeScript, type QueryResult } from "@/lib/sqlite";
import { db as prisma } from "@/lib/db";
import { resolveManagedDatabase, errorResponse } from "@/lib/api-helpers";

/** POST executes a SQL script (possibly multi-statement). */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const { record, sqlite } = await resolveManagedDatabase(id);
    const body = (await req.json()) as { sql?: string };
    const sql = body.sql?.trim();
    if (!sql) return errorResponse(new Error("No SQL provided"));

    const start = performance.now();
    const result: QueryResult = executeScript(sqlite, sql);
    const totalMs = Math.round(performance.now() - start);

    // Persist history entry.
    const lastStmt = result.statements[result.statements.length - 1];
    const rowCount = result.statements.reduce(
      (acc, s) => acc + (s.rows?.length ?? 0),
      0
    );
    await prisma.queryHistory.create({
      data: {
        databaseId: id,
        query: sql,
        success: result.ok,
        rowCount,
        durationMs: totalMs,
        error: lastStmt?.error ?? null,
      },
    });

    // Refresh file size after writes.
    prisma.managedDatabase
      .update({ where: { id }, data: { fileSize: 0 } })
      .catch(() => {});

    return NextResponse.json({ ...result, databaseName: record.name });
  } catch (e) {
    return errorResponse(e);
  }
}
