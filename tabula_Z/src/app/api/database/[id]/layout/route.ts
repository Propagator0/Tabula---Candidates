import { NextResponse } from "next/server";
import { db as prisma } from "@/lib/db";
import { errorResponse } from "@/lib/api-helpers";

/** GET returns saved table card positions for the ER diagram. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const layouts = await prisma.tableLayout.findMany({
      where: { databaseId: id },
    });
    return NextResponse.json({ layouts });
  } catch (e) {
    return errorResponse(e);
  }
}

/** PUT upserts an array of { tableName, x, y, note? } positions. */
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = (await req.json()) as {
      layouts: { tableName: string; x: number; y: number; note?: string | null }[];
    };
    // Replace strategy: wipe then recreate (small dataset).
    await prisma.tableLayout.deleteMany({ where: { databaseId: id } });
    if (body.layouts.length > 0) {
      await prisma.tableLayout.createMany({
        data: body.layouts.map((l) => ({
          databaseId: id,
          tableName: l.tableName,
          x: l.x,
          y: l.y,
          note: l.note ?? null,
        })),
      });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
