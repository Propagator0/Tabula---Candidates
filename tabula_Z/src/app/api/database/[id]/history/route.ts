import { NextResponse } from "next/server";
import { db as prisma } from "@/lib/db";
import { errorResponse } from "@/lib/api-helpers";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const url = new URL(req.url);
    const limit = Math.min(Number(url.searchParams.get("limit") || "50"), 200);
    const history = await prisma.queryHistory.findMany({
      where: { databaseId: id },
      orderBy: { executedAt: "desc" },
      take: limit,
    });
    return NextResponse.json({ history });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    await prisma.queryHistory.deleteMany({ where: { databaseId: id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
