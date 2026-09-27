"use client";

import { useEffect, useCallback, useMemo } from "react";
import { useStore, useActiveDatabase } from "@/lib/store";
import { ErDiagram } from "@/components/er-diagram";
import { type TableLayout } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Save, LayoutGrid, Loader2 } from "lucide-react";
import { useState } from "react";

const CARD_W = 220;
const HEADER_H = 34;
const ROW_H = 24;

export function ErDiagramTab() {
  const { activeDatabaseId, schema, tableLayouts, setTableLayouts, upsertLayout } = useStore();
  const [saving, setSaving] = useState(false);

  // Load layouts when DB changes
  useEffect(() => {
    if (!activeDatabaseId) return;
    fetch(`/api/databases/${activeDatabaseId}/layout`)
      .then((r) => r.json())
      .then((d) => setTableLayouts(d.layouts || []));
  }, [activeDatabaseId, setTableLayouts]);

  const onLayoutChange = useCallback(
    (tableName: string, x: number, y: number) => {
      upsertLayout({ tableName, x, y });
    },
    [upsertLayout]
  );

  const onSaveLayouts = useCallback(async () => {
    if (!activeDatabaseId) return;
    setSaving(true);
    try {
      const layouts = tableLayouts.map((l) => ({
        tableName: l.tableName,
        x: l.x,
        y: l.y,
        note: l.note ?? null,
      }));
      const res = await fetch(`/api/databases/${activeDatabaseId}/layout`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ layouts }),
      });
      if (!res.ok) throw new Error("Failed to save layout");
      toast.success("Layout saved");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }, [activeDatabaseId, tableLayouts]);

  const autoLayout = useCallback(() => {
    if (!schema) return;
    // Simple grid auto-layout: arrange tables in a grid with spacing.
    const tables = schema.tables;
    const cols = Math.ceil(Math.sqrt(tables.length));
    const gapX = CARD_W + 80;
    const gapY = 40;
    const next: TableLayout[] = tables.map((t, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const height = HEADER_H + (t.columns.length || 1) * ROW_H + 8;
      return {
        tableName: t.name,
        x: 60 + col * gapX,
        y: 60 + row * (gapY + 180 + Math.max(0, height - 120)),
      };
    });
    setTableLayouts(next);
    toast.success("Auto-arranged tables");
  }, [schema, setTableLayouts]);

  // Merge existing layouts with schema tables (so new tables get a default position).
  const effectiveLayouts = useMemo(() => {
    if (!schema) return [];
    return schema.tables.map((t) => {
      const existing = tableLayouts.find((l) => l.tableName === t.name);
      const height = HEADER_H + t.columns.length * ROW_H;
      return existing
        ? existing
        : {
            tableName: t.name,
            x: 80 + Math.random() * 200,
            y: 80 + Math.random() * 160,
          };
    });
  }, [schema, tableLayouts]);

  if (!schema) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="relative h-full">
      <ErDiagram
        schema={schema}
        layouts={effectiveLayouts}
        onLayoutChange={onLayoutChange}
        onSaveLayouts={onSaveLayouts}
        onTableClick={(name) => useStore.getState().openTab("design", { table: name })}
        autoLayout={autoLayout}
      />
      {saving && (
        <div className="absolute bottom-3 right-3 flex items-center gap-1.5 text-xs bg-card/80 backdrop-blur border rounded px-2 py-1 shadow-sm">
          <Loader2 className="h-3 w-3 animate-spin" /> Saving…
        </div>
      )}
      <div className="absolute top-3 right-3 flex items-center gap-1.5 z-20">
        <Badge variant="secondary" className="text-[10px] bg-card/80 backdrop-blur border">
          {schema.tables.length} tables · {schema.views.length} views · {schema.triggers.length} triggers
        </Badge>
      </div>
    </div>
  );
}
