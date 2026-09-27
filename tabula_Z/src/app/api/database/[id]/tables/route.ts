import { NextResponse } from "next/server";
import { listTables, getTableSchema, quoteIdent, executeScript } from "@/lib/sqlite";
import { resolveManagedDatabase, errorResponse } from "@/lib/api-helpers";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const { sqlite } = await resolveManagedDatabase(id);
    const tables = listTables(sqlite).map((t) => {
      if (t.type === "table") {
        try {
          const schema = getTableSchema(sqlite, t.name);
          return {
            ...t,
            rowCount: schema.rowCount,
            columnCount: schema.columns.length,
          };
        } catch {
          return { ...t, rowCount: 0, columnCount: 0 };
        }
      }
      return { ...t, rowCount: 0, columnCount: 0 };
    });
    return NextResponse.json({ tables });
  } catch (e) {
    return errorResponse(e);
  }
}

interface ColumnDef {
  name: string;
  type: string;
  notNull?: boolean;
  primaryKey?: boolean;
  autoincrement?: boolean;
  unique?: boolean;
  defaultValue?: string | null;
  check?: string | null;
  foreignKey?: { table: string; column: string } | null;
}

/**
 * POST creates a new table from a declarative column definition payload.
 * Body: { name: string, columns: ColumnDef[], ifNotExists?: boolean }
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const { sqlite } = await resolveManagedDatabase(id);
    const body = (await req.json()) as {
      name?: string;
      columns?: ColumnDef[];
      ifNotExists?: boolean;
    };
    if (!body.name || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(body.name)) {
      return errorResponse(new Error("Invalid table name"));
    }
    if (!body.columns || body.columns.length === 0) {
      return errorResponse(new Error("At least one column is required"));
    }

    const colDefs: string[] = [];
    const constraints: string[] = [];
    for (const c of body.columns) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(c.name)) {
        return errorResponse(new Error(`Invalid column name: ${c.name}`));
      }
      let line = `${quoteIdent(c.name)} ${c.type.toUpperCase()}`;
      if (c.primaryKey) line += " PRIMARY KEY";
      if (c.autoincrement) line += " AUTOINCREMENT";
      if (c.notNull) line += " NOT NULL";
      if (c.unique) line += " UNIQUE";
      if (c.defaultValue !== undefined && c.defaultValue !== null) {
        line += ` DEFAULT ${c.defaultValue}`;
      }
      if (c.check) line += ` CHECK (${c.check})`;
      colDefs.push(line);
      if (c.foreignKey) {
        constraints.push(
          `FOREIGN KEY (${quoteIdent(c.name)}) REFERENCES ${quoteIdent(c.foreignKey.table)}(${quoteIdent(c.foreignKey.column)})`
        );
      }
    }
    const allDefs = [...colDefs, ...constraints].join(", ");
    const sql = `CREATE TABLE ${body.ifNotExists ? "IF NOT EXISTS " : ""}${quoteIdent(body.name)} (${allDefs});`;

    const result = executeScript(sqlite, sql);
    if (!result.ok) {
      const err = result.statements.find((s) => s.error);
      return NextResponse.json(
        { error: err?.error || "Failed to create table", sql },
        { status: 400 }
      );
    }
    const schema = getTableSchema(sqlite, body.name);
    return NextResponse.json({ table: schema, sql });
  } catch (e) {
    return errorResponse(e);
  }
}
