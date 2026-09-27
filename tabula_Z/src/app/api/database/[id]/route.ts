import { NextResponse } from "next/server";
import { db as prisma } from "@/lib/db";
import { closeDatabase, getDatabaseSchema } from "@/lib/sqlite";
import { resolveManagedDatabase, errorResponse } from "@/lib/api-helpers";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const { record, sqlite } = await resolveManagedDatabase(id);
    const schema = getDatabaseSchema(sqlite);
    const tableLayouts = await prisma.tableLayout.findMany({
      where: { databaseId: id },
    });
    return NextResponse.json({
      database: record,
      schema,
      tableLayouts,
    });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const rec = await prisma.managedDatabase.findUnique({ where: { id } });
    if (!rec) return errorResponse(new Error("Database not found"));
    // Close the connection & remove from registry. The file itself is NOT deleted.
    closeDatabase(rec.filePath);
    await prisma.managedDatabase.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = await req.json().catch(() => ({}));
    const { name, color } = body as { name?: string; color?: string };
    const updated = await prisma.managedDatabase.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(color !== undefined ? { color } : {}),
      },
    });
    return NextResponse.json({ database: updated });
  } catch (e) {
    return errorResponse(e);
  }
}
