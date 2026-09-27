"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Plus,
  Trash2,
  GripVertical,
  KeyRound,
  Loader2,
  Database,
} from "lucide-react";
import { toast } from "sonner";
import { useStore } from "@/lib/store";

interface ColumnDef {
  id: string;
  name: string;
  type: string;
  primaryKey: boolean;
  autoincrement: boolean;
  notNull: boolean;
  unique: boolean;
  defaultValue: string;
  foreignKeyTable: string;
  foreignKeyColumn: string;
}

const TYPES = [
  "INTEGER",
  "TEXT",
  "REAL",
  "BLOB",
  "NUMERIC",
  "VARCHAR(255)",
  "BOOLEAN",
  "DATE",
  "DATETIME",
];

function newColumn(): ColumnDef {
  return {
    id: Math.random().toString(36).slice(2),
    name: "",
    type: "TEXT",
    primaryKey: false,
    autoincrement: false,
    notNull: false,
    unique: false,
    defaultValue: "",
    foreignKeyTable: "",
    foreignKeyColumn: "",
  };
}

export function CreateTableDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { activeDatabaseId, schema, setRefreshKey, openTab } = useStore();
  const [tableName, setTableName] = useState("");
  const [columns, setColumns] = useState<ColumnDef[]>([
    { ...newColumn(), name: "id", type: "INTEGER", primaryKey: true, autoincrement: true, notNull: true },
  ]);
  const [loading, setLoading] = useState(false);

  const reset = () => {
    setTableName("");
    setColumns([
      { ...newColumn(), name: "id", type: "INTEGER", primaryKey: true, autoincrement: true, notNull: true },
    ]);
  };

  const update = (id: string, patch: Partial<ColumnDef>) => {
    setColumns((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  };
  const remove = (id: string) =>
    setColumns((cs) => cs.filter((c) => c.id !== id));
  const add = () => setColumns((cs) => [...cs, newColumn()]);

  const submit = async () => {
    if (!activeDatabaseId) return;
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(tableName)) {
      toast.error("Invalid table name");
      return;
    }
    if (columns.length === 0) {
      toast.error("Add at least one column");
      return;
    }
    for (const c of columns) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(c.name)) {
        toast.error(`Invalid column name: "${c.name || "(empty)"}"`);
        return;
      }
    }

    setLoading(true);
    try {
      const payload = {
        name: tableName,
        ifNotExists: true,
        columns: columns.map((c) => ({
          name: c.name,
          type: c.type,
          primaryKey: c.primaryKey,
          autoincrement: c.autoincrement,
          notNull: c.notNull,
          unique: c.unique,
          defaultValue: c.defaultValue.trim() || null,
          foreignKey:
            c.foreignKeyTable && c.foreignKeyColumn
              ? { table: c.foreignKeyTable, column: c.foreignKeyColumn }
              : null,
        })),
      };
      const res = await fetch(
        `/api/databases/${activeDatabaseId}/tables`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create table");
      toast.success(`Created table "${tableName}"`);
      setRefreshKey();
      reset();
      onOpenChange(false);
      openTab("design", { table: tableName });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto scroll-thin">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Database className="h-4 w-4 text-primary" />
            Create new table
          </DialogTitle>
          <DialogDescription>
            Define the table name and its columns. Foreign keys are optional.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="tbl-name">Table name</Label>
            <Input
              id="tbl-name"
              placeholder="e.g. users"
              value={tableName}
              onChange={(e) => setTableName(e.target.value)}
              className="font-mono"
            />
          </div>

          <div className="rounded-md border overflow-hidden">
            <div className="grid grid-cols-[24px_1.4fr_1fr_60px_56px_52px_1.2fr_1fr_32px] items-center gap-2 px-2 py-1.5 bg-muted/50 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <span />
              <span>Column</span>
              <span>Type</span>
              <span className="text-center">PK</span>
              <span className="text-center">Null</span>
              <span className="text-center">Unique</span>
              <span>Default</span>
              <span>FK → table.col</span>
              <span />
            </div>
            <div className="divide-y">
              {columns.map((c, idx) => (
                <div
                  key={c.id}
                  className="grid grid-cols-[24px_1.4fr_1fr_60px_56px_52px_1.2fr_1fr_32px] items-center gap-2 px-2 py-2 hover:bg-muted/30"
                >
                  <GripVertical className="h-3.5 w-3.5 text-muted-foreground/50" />
                  <Input
                    placeholder="column_name"
                    value={c.name}
                    onChange={(e) => update(c.id, { name: e.target.value })}
                    className="h-8 font-mono text-xs"
                  />
                  <Select
                    value={c.type}
                    onValueChange={(v) => update(c.id, { type: v })}
                  >
                    <SelectTrigger className="h-8 font-mono text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TYPES.map((t) => (
                        <SelectItem key={t} value={t} className="font-mono text-xs">
                          {t}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="flex justify-center">
                    <Checkbox
                      checked={c.primaryKey}
                      onCheckedChange={(v) =>
                        update(c.id, {
                          primaryKey: !!v,
                          notNull: !!v ? true : c.notNull,
                        })
                      }
                    />
                  </div>
                  <div className="flex justify-center">
                    <Checkbox
                      checked={!c.notNull}
                      onCheckedChange={(v) => update(c.id, { notNull: !v })}
                    />
                  </div>
                  <div className="flex justify-center">
                    <Checkbox
                      checked={c.unique}
                      onCheckedChange={(v) => update(c.id, { unique: !!v })}
                    />
                  </div>
                  <Input
                    placeholder="—"
                    value={c.defaultValue}
                    onChange={(e) =>
                      update(c.id, { defaultValue: e.target.value })
                    }
                    className="h-8 font-mono text-xs"
                  />
                  <div className="flex gap-1">
                    <Select
                      value={c.foreignKeyTable}
                      onValueChange={(v) => update(c.id, { foreignKeyTable: v })}
                    >
                      <SelectTrigger className="h-8 font-mono text-xs">
                        <SelectValue placeholder="—" />
                      </SelectTrigger>
                      <SelectContent>
                        {schema?.tables
                          .filter((t) => t.name !== tableName)
                          .map((t) => (
                            <SelectItem key={t.name} value={t.name}>
                              {t.name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                    <Select
                      value={c.foreignKeyColumn}
                      onValueChange={(v) =>
                        update(c.id, { foreignKeyColumn: v })
                      }
                      disabled={!c.foreignKeyTable}
                    >
                      <SelectTrigger className="h-8 font-mono text-xs">
                        <SelectValue placeholder="—" />
                      </SelectTrigger>
                      <SelectContent>
                        {schema?.tables
                          .find((t) => t.name === c.foreignKeyTable)
                          ?.columns.map((col) => (
                            <SelectItem key={col.name} value={col.name}>
                              {col.name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    onClick={() => remove(c.id)}
                    disabled={columns.length === 1}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
            <button
              onClick={add}
              className="w-full flex items-center justify-center gap-1.5 py-2 text-xs text-muted-foreground hover:bg-muted/40 hover:text-foreground border-t"
            >
              <Plus className="h-3 w-3" /> Add column
            </button>
          </div>

          {columns.some((c) => c.primaryKey && c.type === "INTEGER") && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/40 rounded-md px-3 py-2">
              <KeyRound className="h-3.5 w-3.5 tint-pk" />
              <span>INTEGER primary keys are auto-incrementing in SQLite.</span>
              <Switch
                checked={columns.find((c) => c.primaryKey)?.autoincrement ?? false}
                onCheckedChange={(v) =>
                  update(
                    columns.find((c) => c.primaryKey)?.id ?? "",
                    { autoincrement: v }
                  )
                }
              />
              <span className="ml-1">AUTOINCREMENT</span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Create table
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
