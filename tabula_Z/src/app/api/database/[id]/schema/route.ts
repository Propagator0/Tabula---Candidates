import { NextResponse } from "next/server";
import { getDatabaseSchema } from "@/lib/sqlite";
import { resolveManagedDatabase, errorResponse } from "@/lib/api-helpers";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const { sqlite } = await resolveManagedDatabase(id);
    const schema = getDatabaseSchema(sqlite);
    return NextResponse.json({ schema });
  } catch (e) {
    return errorResponse(e);
  }
}
