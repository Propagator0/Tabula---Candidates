import { NextResponse } from "next/server";
import { executeScript, type ExecutedStatement } from "@/lib/sqlite";
import { db as prisma } from "@/lib/db";
import { resolveManagedDatabase, errorResponse } from "@/lib/api-helpers";

/**
 * POST /api/databases/[id]/import
 * Body: { sql: string } — a SQL script (typically a schema dump) to execute
 * against the database. Runs within better-sqlite3's automatic transaction
 * for exec(), and returns per-statement results.
 */
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
    const result = executeScript(sqlite, sql);
    const totalMs = Math.round(performance.now() - start);

    // Persist a history entry summarizing the import.
    const changeCount = result.statements.reduce(
      (acc, s) => acc + (s.type === "modify" ? s.changes ?? 0 : 0),
      0
    );
    const stmtCount = result.statements.length;
    await prisma.queryHistory.create({
      data: {
        databaseId: id,
        query: `-- IMPORT (${stmtCount} statement${stmtCount === 1 ? "" : "s"}, ${changeCount} change${changeCount === 1 ? "" : "s"})\n${sql.slice(0, 2000)}`,
        success: result.ok,
        rowCount: result.statements.reduce((a, s) => a + (s.rows?.length ?? 0), 0),
        durationMs: totalMs,
        error: result.statements.find((s) => s.error)?.error ?? null,
      },
    });

    const summary: {
      ok: boolean;
      totalDurationMs: number;
      statements: ExecutedStatement[];
      databaseName: string;
      changeCount: number;
    } = { ...result, totalDurationMs: totalMs, databaseName: record.name, changeCount };

    return NextResponse.json(summary);
  } catch (e) {
    return errorResponse(e);
  }
}
