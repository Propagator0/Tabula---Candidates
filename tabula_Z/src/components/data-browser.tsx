"use client";

import { useEffect, useState, useCallback } from "react";
import { useStore } from "@/lib/store";
import type { ColumnInfo, TableSchema } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Loader2,
  Plus,
  Trash2,
  Check,
  X,
  Pencil,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Download,
} from "lucide-react";
import { toast } from "sonner";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface DataBrowserProps {
  tableName: string;
}

const PAGE_SIZE = 50;

export function DataBrowser({ tableName }: DataBrowserProps) {
  const { activeDatabaseId, setLastQuery, setRefreshKey } = useStore();
  const [schema, setSchema] = useState<TableSchema | null>(null);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [orderColumn, setOrderColumn] = useState<string | null>(null);
  const [orderDir, setOrderDir] = useState<"ASC" | "DESC">("ASC");
  const [where, setWhere] = useState("");
  const [whereInput, setWhereInput] = useState("");
  const [editing, setEditing] = useState<{
    pkValue: unknown;
    values: Record<string, string>;
  } | null>(null);
  const [insertOpen, setInsertOpen] = useState(false);

  const load = useCallback(async () => {
    if (!activeDatabaseId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(page * PAGE_SIZE),
      });
      if (orderColumn) {
        params.set("orderColumn", orderColumn);
        params.set("orderDir", orderDir);
      }
      if (where.trim()) params.set("where", where.trim());
      const res = await fetch(
        `/api/databases/${activeDatabaseId}/tables/${encodeURIComponent(tableName)}/data?${params}`
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setRows(data.rows);
      setTotal(data.total);
      setSchema({ ...data, name: tableName, type: "table", sql: "", foreignKeys: [], indexes: [] } as TableSchema);
      setLastQuery({ ok: true, durationMs: 0, rowCount: data.rows.length });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [activeDatabaseId, tableName, page, orderColumn, orderDir, where, setLastQuery]);

  // Load schema once
  useEffect(() => {
    if (!activeDatabaseId) return;
    fetch(`/api/databases/${activeDatabaseId}/tables/${encodeURIComponent(tableName)}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.table) {
          setSchema(d.table);
          const pk = d.table.columns.find((c: ColumnInfo) => c.pk);
          if (pk) setOrderColumn(pk.name);
        }
      });
  }, [activeDatabaseId, tableName]);

  useEffect(() => {
    load();
  }, [load]);

  const pkCol = schema?.columns.find((c) => c.pk);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const toggleOrder = (col: string) => {
    if (orderColumn === col) {
      setOrderDir((d) => (d === "ASC" ? "DESC" : "ASC"));
    } else {
      setOrderColumn(col);
      setOrderDir("ASC");
    }
    setPage(0);
  };

  const applyFilter = () => {
    setWhere(whereInput);
    setPage(0);
  };
  const clearFilter = () => {
    setWhereInput("");
    setWhere("");
    setPage(0);
  };

  const startEdit = (row: Record<string, unknown>) => {
    if (!pkCol) {
      toast.error("This table has no primary key; inline editing is disabled.");
      return;
    }
    const values: Record<string, string> = {};
    for (const c of schema?.columns ?? []) {
      values[c.name] = row[c.name] == null ? "" : String(row[c.name]);
    }
    setEditing({ pkValue: row[pkCol.name], values });
  };

  const saveEdit = async () => {
    if (!editing || !pkCol || !activeDatabaseId) return;
    const row: Record<string, unknown> = {};
    for (const c of schema?.columns ?? []) {
      const v = editing.values[c.name];
      if (v === "") {
        row[c.name] = null;
      } else if (c.type.toUpperCase().includes("INT")) {
        row[c.name] = Number(v);
      } else if (
        c.type.toUpperCase().includes("REAL") ||
        c.type.toUpperCase().includes("FLOA") ||
        c.type.toUpperCase().includes("DOUB")
      ) {
        row[c.name] = Number(v);
      } else {
        row[c.name] = v;
      }
    }
    const res = await fetch(
      `/api/databases/${activeDatabaseId}/tables/${encodeURIComponent(tableName)}/data`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pkColumn: pkCol.name, pkValue: editing.pkValue, row }),
      }
    );
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error || "Update failed");
      return;
    }
    toast.success("Row updated");
    setEditing(null);
    load();
    setRefreshKey();
  };

  const deleteRow = async (pkValue: unknown) => {
    if (!pkCol || !activeDatabaseId) return;
    const res = await fetch(
      `/api/databases/${activeDatabaseId}/tables/${encodeURIComponent(tableName)}/data`,
      {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pkColumn: pkCol.name, pkValue }),
      }
    );
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error || "Delete failed");
      return;
    }
    toast.success("Row deleted");
    load();
    setRefreshKey();
  };

  const exportCsv = () => {
    if (!rows.length) return;
    const cols = schema?.columns.map((c) => c.name) ?? Object.keys(rows[0]);
    const escape = (v: unknown) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [
      cols.join(","),
      ...rows.map((r) => cols.map((c) => escape(r[c])).join(",")),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${tableName}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/20 flex-wrap">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-mono font-semibold">{tableName}</span>
          <Badge variant="secondary" className="text-[10px]">
            {total.toLocaleString()} rows
          </Badge>
        </div>
        <div className="flex items-center gap-1 ml-2">
          <Input
            placeholder="WHERE clause (e.g. published = 1)"
            value={whereInput}
            onChange={(e) => setWhereInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && applyFilter()}
            className="h-7 w-56 font-mono text-xs"
          />
          <Button size="sm" variant="outline" className="h-7" onClick={applyFilter}>
            Filter
          </Button>
          {where && (
            <Button size="sm" variant="ghost" className="h-7" onClick={clearFilter}>
              <X className="h-3 w-3" />
            </Button>
          )}
        </div>
        <div className="ml-auto flex items-center gap-1">
          <Button size="sm" variant="outline" className="h-7" onClick={exportCsv} disabled={!rows.length}>
            <Download className="h-3.5 w-3.5 mr-1" /> CSV
          </Button>
          <Button size="sm" variant="outline" className="h-7" onClick={() => setInsertOpen(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Insert
          </Button>
          <Button size="sm" variant="ghost" className="h-7" onClick={load}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-auto scroll-thin">
        {loading ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
            <p className="text-sm">No rows found.</p>
            <Button size="sm" variant="outline" onClick={() => setInsertOpen(true)}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Insert first row
            </Button>
          </div>
        ) : (
          <table className="w-full text-xs border-collapse">
            <thead className="sticky top-0 z-10 bg-card">
              <tr className="border-b">
                <th className="w-10 sticky left-0 bg-card border-r px-1 text-center text-[10px] text-muted-foreground">
                  #
                </th>
                {schema?.columns.map((c) => (
                  <th
                    key={c.name}
                    className="text-left border-r px-2 py-1.5 font-semibold whitespace-nowrap select-none cursor-pointer hover:bg-muted/50 min-w-[120px]"
                    onClick={() => toggleOrder(c.name)}
                  >
                    <div className="flex items-center gap-1">
                      {c.pk && <span className="tint-pk">●</span>}
                      <span className="font-mono">{c.name}</span>
                      <span className="text-[9px] font-normal text-muted-foreground uppercase">
                        {c.type || "blob"}
                      </span>
                      {orderColumn === c.name ? (
                        orderDir === "ASC" ? (
                          <ArrowUp className="h-3 w-3 text-primary" />
                        ) : (
                          <ArrowDown className="h-3 w-3 text-primary" />
                        )
                      ) : (
                        <ArrowUpDown className="h-3 w-3 text-muted-foreground/40" />
                      )}
                    </div>
                  </th>
                ))}
                <th className="w-16 sticky right-0 bg-card border-l px-1 text-center text-[10px] text-muted-foreground">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const pkValue = pkCol ? row[pkCol.name] : null;
                const isEditing =
                  editing && pkCol && editing.pkValue === pkValue;
                return (
                  <tr key={i} className="border-b hover:bg-muted/20 group">
                    <td className="w-10 sticky left-0 bg-card border-r px-1 text-center text-[10px] text-muted-foreground tabular-nums">
                      {page * PAGE_SIZE + i + 1}
                    </td>
                    {schema?.columns.map((c) => (
                      <td
                        key={c.name}
                        className="border-r px-2 py-1 font-mono text-[11px] align-top max-w-[280px]"
                      >
                        {isEditing ? (
                          <Input
                            value={editing!.values[c.name] ?? ""}
                            onChange={(e) =>
                              setEditing({
                                ...editing!,
                                values: {
                                  ...editing!.values,
                                  [c.name]: e.target.value,
                                },
                              })
                            }
                            className="h-6 text-[11px] font-mono"
                          />
                        ) : (
                          <CellValue value={row[c.name]} type={c.type} />
                        )}
                      </td>
                    ))}
                    <td className="w-16 sticky right-0 bg-card border-l px-1">
                      <div className="flex items-center justify-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        {isEditing ? (
                          <>
                            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={saveEdit}>
                              <Check className="h-3.5 w-3.5 text-[var(--type-text)]" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-6 w-6"
                              onClick={() => setEditing(null)}
                            >
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </>
                        ) : (
                          <>
                            <TooltipProvider delayDuration={400}>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-6 w-6"
                                    onClick={() => startEdit(row)}
                                    disabled={!pkCol}
                                  >
                                    <Pencil className="h-3 w-3" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent side="left">
                                  {pkCol ? "Edit row" : "No primary key"}
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-6 w-6 text-muted-foreground hover:text-destructive"
                              onClick={() => deleteRow(pkValue)}
                              disabled={!pkCol}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between px-3 py-1.5 border-t bg-muted/20 text-xs">
        <span className="text-muted-foreground font-mono">
          {total === 0
            ? "0 rows"
            : `${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, total)} of ${total.toLocaleString()}`}
        </span>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="outline"
            className="h-7"
            disabled={page === 0}
            onClick={() => setPage(0)}
          >
            First
          </Button>
          <Button
            size="icon"
            variant="outline"
            className="h-7 w-7"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <span className="font-mono px-2">
            {page + 1} / {totalPages}
          </span>
          <Button
            size="icon"
            variant="outline"
            className="h-7 w-7"
            disabled={page >= totalPages - 1}
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7"
            disabled={page >= totalPages - 1}
            onClick={() => setPage(totalPages - 1)}
          >
            Last
          </Button>
        </div>
      </div>

      {insertOpen && schema && (
        <InsertDialog
          tableName={tableName}
          columns={schema.columns}
          onClose={() => setInsertOpen(false)}
          onInserted={() => {
            setInsertOpen(false);
            load();
            setRefreshKey();
          }}
        />
      )}
    </div>
  );
}

function CellValue({ value, type }: { value: unknown; type: string }) {
  if (value == null) {
    return <span className="text-muted-foreground italic">NULL</span>;
  }
  const t = (type || "").toUpperCase();
  if (t.includes("INT")) {
    return <span className="tint-integer tabular-nums">{String(value)}</span>;
  }
  if (t.includes("REAL") || t.includes("FLOA") || t.includes("DOUB")) {
    return <span className="tint-real tabular-nums">{String(value)}</span>;
  }
  const s = String(value);
  if (s.length > 200) {
    return <span className="truncate inline-block max-w-[280px] align-top">{s.slice(0, 200)}…</span>;
  }
  return <span className="truncate inline-block max-w-[280px] align-top">{s}</span>;
}

function InsertDialog({
  tableName,
  columns,
  onClose,
  onInserted,
}: {
  tableName: string;
  columns: ColumnInfo[];
  onClose: () => void;
  onInserted: () => void;
}) {
  const { activeDatabaseId } = useStore();
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setLoading(true);
    const row: Record<string, unknown> = {};
    for (const c of columns) {
      const v = values[c.name];
      if (v === undefined || v === "") continue;
      if (c.type.toUpperCase().includes("INT")) row[c.name] = Number(v);
      else if (
        c.type.toUpperCase().includes("REAL") ||
        c.type.toUpperCase().includes("FLOA") ||
        c.type.toUpperCase().includes("DOUB")
      )
        row[c.name] = Number(v);
      else row[c.name] = v;
    }
    const res = await fetch(
      `/api/databases/${activeDatabaseId}/tables/${encodeURIComponent(tableName)}/data`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ row }),
      }
    );
    const data = await res.json();
    setLoading(false);
    if (!res.ok) {
      toast.error(data.error || "Insert failed");
      return;
    }
    toast.success("Row inserted");
    onInserted();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-card border rounded-lg shadow-xl w-full max-w-lg max-h-[80vh] overflow-y-auto scroll-thin">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h3 className="font-semibold text-sm">
            Insert into <span className="font-mono">{tableName}</span>
          </h3>
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="p-4 space-y-3">
          {columns.map((c) => (
            <div key={c.name} className="grid grid-cols-3 gap-2 items-center">
              <div className="col-span-1">
                <div className="font-mono text-xs font-medium flex items-center gap-1">
                  {c.pk && <span className="tint-pk">●</span>}
                  {c.name}
                </div>
                <div className="text-[10px] text-muted-foreground uppercase">{c.type || "blob"}</div>
              </div>
              <Input
                placeholder={c.dfltValue ?? (c.notNull ? "required" : "NULL")}
                value={values[c.name] ?? ""}
                onChange={(e) =>
                  setValues({ ...values, [c.name]: e.target.value })
                }
                className="col-span-2 h-8 font-mono text-xs"
              />
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-2 px-4 py-3 border-t">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit} disabled={loading}>
            {loading && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
            Insert row
          </Button>
        </div>
      </div>
    </div>
  );
}
