"use client";

import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import {
  type ColumnInfo,
  type TableSchema,
  typeTextClass,
} from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  KeyRound,
  Link2,
  Hash,
  Type,
  Binary,
  Pencil,
  Trash2,
  Eraser,
  Copy,
  Check,
  RefreshCw,
  Loader2,
  Layers,
} from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export function TableDesigner({ tableName }: { tableName: string }) {
  const { activeDatabaseId, schema, setRefreshKey, openTab } = useStore();
  const [table, setTable] = useState<TableSchema | null>(null);
  const [loading, setLoading] = useState(true);
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState("");
  const [confirmTruncate, setConfirmTruncate] = useState(false);

  useEffect(() => {
    let alive = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    fetch(`/api/databases/${activeDatabaseId}/tables/${encodeURIComponent(tableName)}`)
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        if (d.table) {
          setTable(d.table);
          setNewName(d.table.name);
        }
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [activeDatabaseId, tableName, schema]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }
  if (!table) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        Table not found.
      </div>
    );
  }

  const copyDdl = () => {
    navigator.clipboard.writeText(table.sql || "");
    toast.success("DDL copied to clipboard");
  };

  const doRename = async () => {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(newName) || newName === table.name) {
      setRenaming(false);
      return;
    }
    const res = await fetch(
      `/api/databases/${activeDatabaseId}/tables/${encodeURIComponent(table.name)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "rename", newName }),
      }
    );
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error || "Rename failed");
      return;
    }
    toast.success(`Renamed to "${newName}"`);
    setRenaming(false);
    setRefreshKey();
    openTab("design", { table: newName });
  };

  const doTruncate = async () => {
    const res = await fetch(
      `/api/databases/${activeDatabaseId}/tables/${encodeURIComponent(table.name)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "truncate" }),
      }
    );
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error || "Truncate failed");
      return;
    }
    toast.success(`Cleared all rows from "${table.name}"`);
    setConfirmTruncate(false);
    setRefreshKey();
  };

  return (
    <div className="h-full overflow-y-auto scroll-thin p-4 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-semibold font-mono">{table.name}</h2>
            <Badge variant="secondary" className="uppercase text-[10px]">
              {table.type}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {table.columns.length} columns · {table.rowCount.toLocaleString()} rows ·{" "}
            {table.indexes.length} indexes
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {renaming ? (
            <div className="flex items-center gap-1">
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="h-8 w-40 font-mono text-sm"
                onKeyDown={(e) => e.key === "Enter" && doRename()}
              />
              <Button size="sm" onClick={doRename}>
                <Check className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setRenaming(false);
                  setNewName(table.name);
                }}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setRenaming(true)}>
              <Pencil className="h-3.5 w-3.5 mr-1" /> Rename
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => setConfirmTruncate(true)}
          >
            <Eraser className="h-3.5 w-3.5 mr-1" /> Truncate
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setRefreshKey();
            }}
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Columns */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Hash className="h-4 w-4 text-muted-foreground" /> Columns
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="grid grid-cols-[40px_1.5fr_1fr_1fr_1fr_2fr] gap-2 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground border-b bg-muted/30">
            <span />
            <span>Name</span>
            <span>Type</span>
            <span>Constraints</span>
            <span>Default</span>
            <span>Foreign key</span>
          </div>
          <div className="divide-y">
            {table.columns.map((c) => (
              <ColumnRow key={c.cid} col={c} />
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Indexes & DDL row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Layers className="h-4 w-4 text-muted-foreground" /> Indexes
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {table.indexes.length === 0 && (
              <p className="text-xs text-muted-foreground">No indexes.</p>
            )}
            {table.indexes.map((i) => (
              <div
                key={i.name}
                className="flex items-center gap-2 text-xs font-mono px-2 py-1.5 rounded bg-muted/40"
              >
                {i.unique ? (
                  <Badge className="chip-real text-[9px] h-4">UNIQUE</Badge>
                ) : (
                  <Badge variant="outline" className="text-[9px] h-4">IDX</Badge>
                )}
                <span className="truncate">{i.name}</span>
                <span className="text-muted-foreground">({i.columns.join(", ")})</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <Type className="h-4 w-4 text-muted-foreground" /> DDL
              </CardTitle>
              <Button size="sm" variant="ghost" onClick={copyDdl}>
                <Copy className="h-3.5 w-3.5 mr-1" /> Copy
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <pre className="text-[11px] font-mono whitespace-pre-wrap break-words bg-muted/40 rounded-md p-3 max-h-64 overflow-y-auto scroll-thin">
              {table.sql}
            </pre>
          </CardContent>
        </Card>
      </div>

      <Separator />
      <p className="text-[11px] text-muted-foreground pb-2">
        Tip: foreign keys and most column changes require a table rebuild in
        SQLite. Use the Query tab for advanced DDL.
      </p>

      <AlertDialog open={confirmTruncate} onOpenChange={setConfirmTruncate}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear all rows in "{table.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes every row ({table.rowCount.toLocaleString()}) but keeps
              the table structure. The schema remains intact.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={doTruncate}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              <Trash2 className="h-3.5 w-3.5 mr-1" /> Truncate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ColumnRow({ col }: { col: ColumnInfo }) {
  const TypeIcon =
    col.type.toUpperCase().includes("INT")
      ? Hash
      : col.type.toUpperCase().includes("CHAR") ||
          col.type.toUpperCase().includes("TEXT") ||
          col.type.toUpperCase().includes("CLOB")
        ? Type
        : col.type.toUpperCase().includes("BLOB") || col.type === ""
          ? Binary
          : Hash;
  return (
    <div className="grid grid-cols-[40px_1.5fr_1fr_1fr_1fr_2fr] gap-2 px-4 py-2 items-center text-sm hover:bg-muted/20">
      <div className="flex items-center justify-center">
        {col.pk ? (
          <KeyRound className="h-3.5 w-3.5 tint-pk" />
        ) : col.fk ? (
          <Link2 className="h-3.5 w-3.5 tint-fk" />
        ) : (
          <TypeIcon className="h-3.5 w-3.5 text-muted-foreground/60" />
        )}
      </div>
      <span className="font-mono text-[13px] font-medium truncate">
        {col.name}
      </span>
      <span className={`font-mono text-xs ${typeTextClass(col.type)}`}>
        {col.type || "(blob)"}
      </span>
      <div className="flex flex-wrap gap-1">
        {col.pk ? (
          <Badge className="chip-integer text-[9px] h-4 px-1">PK</Badge>
        ) : null}
        {col.autoincrement ? (
          <Badge variant="outline" className="text-[9px] h-4 px-1">A_I</Badge>
        ) : null}
        {(col as ColumnInfo & { unique?: boolean }).unique ? (
          <Badge variant="outline" className="text-[9px] h-4 px-1">UNIQUE</Badge>
        ) : null}
        {col.notNull ? (
          <Badge variant="outline" className="text-[9px] h-4 px-1">NOT NULL</Badge>
        ) : null}
        {!col.pk && col.notNull === 0 && (
          <Badge variant="outline" className="text-[9px] h-4 px-1 text-muted-foreground">
            NULL
          </Badge>
        )}
      </div>
      <span className="font-mono text-[11px] text-muted-foreground truncate">
        {col.dfltValue ?? "—"}
      </span>
      <span className="font-mono text-[11px] text-muted-foreground truncate">
        {col.fk ? (
          <span className="tint-fk">
            → {col.fk.table}.{col.fk.column}
          </span>
        ) : (
          "—"
        )}
      </span>
    </div>
  );
}
