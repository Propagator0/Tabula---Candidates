import { db as prisma } from "@/lib/db";
import { openDatabase } from "@/lib/sqlite";
import type Database from "better-sqlite3";

/**
 * Resolve a managed database record by id, open its SQLite connection,
 * and return both. Throws if not found.
 */
export async function resolveManagedDatabase(id: string) {
  const record = await prisma.managedDatabase.findUnique({ where: { id } });
  if (!record) {
    const err = new Error("Database not found");
    (err as Error & { status?: number }).status = 404;
    throw err;
  }
  // Refresh lastOpenedAt asynchronously (fire & forget).
  prisma.managedDatabase
    .update({ where: { id }, data: { lastOpenedAt: new Date() } })
    .catch(() => {});

  let sqlite: Database.Database;
  try {
    sqlite = openDatabase(record.filePath);
  } catch (e) {
    const err = new Error(`Cannot open database file: ${(e as Error).message}`);
    (err as Error & { status?: number }).status = 500;
    throw err;
  }
  return { record, sqlite };
}

export function errorResponse(e: unknown) {
  const err = e as Error & { status?: number };
  const status = err.status ?? 500;
  return Response.json({ error: err.message || "Internal server error" }, { status });
}
