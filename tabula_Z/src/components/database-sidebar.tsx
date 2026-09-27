"use client";

import { useEffect, useState } from "react";
import { useStore, useActiveDatabase } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Database as DatabaseIcon,
  Table2,
  Eye,
  Plus,
  RefreshCw,
  ChevronRight,
  ChevronDown,
  Trash2,
  FilePlus2,
  Columns3,
  Network,
  KeyRound,
  Link2,
  Search,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { typeFamily, type TableSchema } from "@/lib/types";
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

interface SidebarProps {
  onAddDatabase: () => void;
  onCreateTable: () => void;
}

export function DatabaseSidebar({ onAddDatabase, onCreateTable }: SidebarProps) {
  const {
    databases,
    activeDatabaseId,
    selectDatabase,
    schema,
    openTab,
    refreshKey,
  } = useStore();
  const active = useActiveDatabase();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [confirmDrop, setConfirmDrop] = useState<TableSchema | null>(null);
  const [refreshCounter, setRefreshCounter] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);

  // trigger refreshKey usage
  void refreshKey;
  void refreshCounter;

  useEffect(() => {
    if (active) {
      setExpanded(new Set());
    }
  }, [activeDatabaseId]);

  const toggle = (name: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const filteredTables = (schema?.tables ?? []).filter((t) =>
    t.name.toLowerCase().includes(filter.toLowerCase())
  );
  const filteredViews = (schema?.views ?? []).filter((v) =>
    v.name.toLowerCase().includes(filter.toLowerCase())
  );

  const handleDrop = async () => {
    if (!confirmDrop || !activeDatabaseId) return;
    try {
      const res = await fetch(
        `/api/databases/${activeDatabaseId}/tables/${encodeURIComponent(confirmDrop.name)}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to drop table");
      }
      toast.success(`Dropped table "${confirmDrop.name}"`);
      setConfirmDrop(null);
      // Trigger a refresh by toggling the store's refresh key via selectDatabase hack
      useStore.getState().setRefreshKey();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <aside className="flex flex-col h-full bg-sidebar text-sidebar-foreground border-r">
      {/* Database switcher */}
      <div className="p-3 border-b">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Databases
          </span>
          <div className="flex items-center gap-0.5">
            <TooltipProvider delayDuration={400}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => {
                      setRefreshCounter((c) => c + 1);
                      useStore.getState().setRefreshKey();
                    }}
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">Refresh</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={onAddDatabase}
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
        <div className="space-y-1 max-h-40 overflow-y-auto scroll-thin">
          {databases.length === 0 && (
            <p className="text-xs text-muted-foreground py-2 px-1">
              No databases yet.
            </p>
          )}
          {databases.map((d) => (
            <button
              key={d.id}
              onClick={() => selectDatabase(d.id)}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-sm transition-colors group ${
                d.id === activeDatabaseId
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "hover:bg-sidebar-accent/60"
              }`}
            >
              <span
                className="h-2.5 w-2.5 rounded-sm shrink-0 ring-1 ring-black/10"
                style={{ backgroundColor: d.color }}
              />
              <span className="truncate flex-1 font-medium">{d.name}</span>
              {!d.reachable && (
                <span className="h-1.5 w-1.5 rounded-full bg-destructive" />
              )}
              {d.tableCount != null && d.reachable && (
                <span className="text-[10px] text-muted-foreground tabular-nums">
                  {d.tableCount}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Tables tree */}
      <div className="flex-1 min-h-0 flex flex-col">
        <div className="flex items-center justify-between px-3 pt-3 pb-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {active ? "Schema" : ""}
          </span>
          {active && (
            <div className="flex items-center gap-0.5">
              <TooltipProvider delayDuration={400}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => setSearchOpen((s) => !s)}
                    >
                      <Search className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="right">Filter tables</TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={onCreateTable}
              >
                <FilePlus2 className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => openTab("er")}
              >
                <Network className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
        </div>

        {searchOpen && (
          <div className="px-3 pb-2">
            <Input
              autoFocus
              placeholder="Filter tables…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="h-7 text-xs"
            />
          </div>
        )}

        <ScrollArea className="flex-1 px-2">
          {!active && (
            <div className="p-4 text-center text-xs text-muted-foreground">
              Select a database to explore its schema.
            </div>
          )}
          {active && (schema?.tables.length ?? 0) === 0 && (
            <div className="p-4 text-center">
              <p className="text-xs text-muted-foreground mb-2">
                No tables in this database.
              </p>
              <Button size="sm" variant="outline" onClick={onCreateTable}>
                <Plus className="h-3.5 w-3.5 mr-1" /> New table
              </Button>
            </div>
          )}

          <div className="space-y-0.5 pb-3">
            {filteredTables.map((t) => (
              <TableTreeItem
                key={t.name}
                table={t}
                expanded={expanded.has(t.name)}
                onToggle={() => toggle(t.name)}
                onOpenData={() => openTab("data", { table: t.name })}
                onOpenDesign={() => openTab("design", { table: t.name })}
                onDrop={() => setConfirmDrop(t)}
              />
            ))}
            {filteredViews.length > 0 && (
              <div className="pt-2">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-2">
                  Views
                </span>
                {filteredViews.map((v) => (
                  <button
                    key={v.name}
                    onClick={() => openTab("data", { table: v.name })}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm hover:bg-sidebar-accent/60 text-left"
                  >
                    <Eye className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="truncate font-mono">{v.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </ScrollArea>
      </div>

      <AlertDialog open={!!confirmDrop} onOpenChange={(o) => !o && setConfirmDrop(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Drop table "{confirmDrop?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the table and all of its data. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDrop}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Drop table
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </aside>
  );
}

function TableTreeItem({
  table,
  expanded,
  onToggle,
  onOpenData,
  onOpenDesign,
  onDrop,
}: {
  table: TableSchema;
  expanded: boolean;
  onToggle: () => void;
  onOpenData: () => void;
  onOpenDesign: () => void;
  onDrop: () => void;
}) {
  return (
    <div className="group/table">
      <div className="flex items-center">
        <button
          onClick={onToggle}
          className="flex items-center gap-1 px-1 py-1.5 rounded-md text-sm hover:bg-sidebar-accent/60 flex-1 min-w-0 text-left"
          onDoubleClick={onOpenData}
        >
          {expanded ? (
            <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
          ) : (
            <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
          )}
          <Table2 className="h-3.5 w-3.5 text-[var(--type-integer)] shrink-0" />
          <span className="truncate font-mono text-[13px]">{table.name}</span>
        </button>
        <div className="flex items-center opacity-0 group-hover/table:opacity-100 transition-opacity pr-1">
          <TooltipProvider delayDuration={400}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={onOpenData}
                >
                  <Columns3 className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">Browse data</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-destructive"
            onClick={onDrop}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>
      {expanded && (
        <div className="ml-6 border-l pl-2 py-0.5 space-y-0.5">
          <button
            onClick={onOpenData}
            className="w-full flex items-center gap-1.5 px-1.5 py-1 rounded text-xs text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground"
          >
            <Columns3 className="h-3 w-3" /> Data
            <span className="ml-auto text-[10px] tabular-nums">{table.rowCount}</span>
          </button>
          <button
            onClick={onOpenDesign}
            className="w-full flex items-center gap-1.5 px-1.5 py-1 rounded text-xs text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground"
          >
            <Table2 className="h-3 w-3" /> Structure
          </button>
          <div className="px-1.5 pt-1 pb-0.5">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Columns
            </span>
          </div>
          {table.columns.map((c) => (
            <div
              key={c.name}
              className="flex items-center gap-1.5 px-1.5 py-0.5 text-[11px] font-mono"
            >
              {c.pk ? (
                <KeyRound className="h-2.5 w-2.5 tint-pk shrink-0" />
              ) : c.fk ? (
                <Link2 className="h-2.5 w-2.5 tint-fk shrink-0" />
              ) : (
                <span className="h-2.5 w-2.5 shrink-0" />
              )}
              <span className="truncate">{c.name}</span>
              <span className="ml-auto text-muted-foreground text-[10px]">
                {c.type || "(blob)"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
