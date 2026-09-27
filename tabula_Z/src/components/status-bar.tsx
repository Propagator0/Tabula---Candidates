"use client";

import { useStore, useActiveDatabase } from "@/lib/store";
import { Database, Table2, Clock, CheckCircle2, XCircle } from "lucide-react";

export function StatusBar() {
  const active = useActiveDatabase();
  const schema = useStore((s) => s.schema);
  const lastQuery = useStore((s) => s.lastQuery);

  const tableCount = schema?.tables.length ?? 0;
  const totalRows = schema?.tables.reduce((acc, t) => acc + (t.rowCount || 0), 0) ?? 0;

  return (
    <footer className="mt-auto h-8 shrink-0 border-t bg-sidebar text-sidebar-foreground flex items-center px-3 gap-4 text-[11px] font-mono select-none">
      <div className="flex items-center gap-1.5">
        <span
          className="h-2 w-2 rounded-full"
          style={{ backgroundColor: active?.reachable ? "var(--type-text)" : "var(--destructive)" }}
        />
        <Database className="h-3 w-3 text-muted-foreground" />
        <span className="truncate max-w-[240px] font-semibold">
          {active ? active.name : "No database"}
        </span>
        {active && (
          <span className="text-muted-foreground truncate hidden sm:inline">
            · {active.filePath}
          </span>
        )}
      </div>

      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Table2 className="h-3 w-3" />
        <span>{tableCount} tables</span>
      </div>

      <div className="hidden md:flex items-center gap-1.5 text-muted-foreground">
        <span>{totalRows.toLocaleString()} rows</span>
      </div>

      <div className="ml-auto flex items-center gap-4">
        {lastQuery && (
          <div className="flex items-center gap-1.5">
            {lastQuery.ok ? (
              <CheckCircle2 className="h-3 w-3 text-[var(--type-text)]" />
            ) : (
              <XCircle className="h-3 w-3 text-destructive" />
            )}
            <span className="text-muted-foreground">
              {lastQuery.rowCount} rows · {lastQuery.durationMs}ms
            </span>
          </div>
        )}
        <div className="hidden sm:flex items-center gap-1.5 text-muted-foreground">
          <Clock className="h-3 w-3" />
          <span>Tabula v1.0</span>
        </div>
      </div>
    </footer>
  );
}
