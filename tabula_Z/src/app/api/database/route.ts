import { NextResponse } from "next/server";
import { db as prisma } from "@/lib/db";
import { openDatabase, validateDatabaseFile, getDatabaseSchema } from "@/lib/sqlite";
import fs from "node:fs";
import path from "node:path";

/** Ensure the demo database is registered on first boot. */
async function ensureDemoRegistered() {
  const demoPath = path.resolve(process.cwd(), "db/demo.sqlite");
  if (!fs.existsSync(demoPath)) return;
  const existing = await prisma.managedDatabase.findUnique({
    where: { filePath: demoPath },
  });
  if (!existing) {
    const stat = fs.statSync(demoPath);
    await prisma.managedDatabase.create({
      data: {
        name: "Demo Blog",
        filePath: demoPath,
        color: "#f59e0b",
        fileSize: stat.size,
        lastOpenedAt: new Date(),
      },
    });
  }
}

export async function GET() {
  await ensureDemoRegistered();
  const databases = await prisma.managedDatabase.findMany({
    orderBy: { lastOpenedAt: "desc" },
    include: { _count: { select: { queryHistory: true } } },
  });

  // Enrich with live table counts where possible.
  const enriched = databases.map((d) => {
    let tableCount: number | null = null;
    let reachable = true;
    try {
      const sqlite = openDatabase(d.filePath);
      const schema = getDatabaseSchema(sqlite);
      tableCount = schema.tables.length;
    } catch {
      reachable = false;
    }
    return { ...d, tableCount, reachable };
  });

  return NextResponse.json({ databases: enriched });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { name, filePath, color } = body as {
    name?: string;
    filePath?: string;
    color?: string;
  };

  if (!filePath || !filePath.trim()) {
    return NextResponse.json(
      { error: "filePath is required" },
      { status: 400 }
    );
  }

  const abs = path.resolve(filePath);
  const check = validateDatabaseFile(abs);
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: 400 });
  }

  // Touch the file so it exists, then open to confirm it's a valid DB.
  try {
    openDatabase(abs);
  } catch (e) {
    return NextResponse.json(
      { error: `Could not open database: ${(e as Error).message}` },
      { status: 400 }
    );
  }

  const stat = fs.existsSync(abs) ? fs.statSync(abs).size : 0;
  const created = await prisma.managedDatabase.upsert({
    where: { filePath: abs },
    update: {
      name: name?.trim() || undefined,
      color: color || undefined,
      fileSize: stat,
      lastOpenedAt: new Date(),
    },
    create: {
      name: name?.trim() || path.basename(abs),
      filePath: abs,
      color: color || "#f59e0b",
      fileSize: stat,
      lastOpenedAt: new Date(),
    },
  });

  return NextResponse.json({ database: created });
}
