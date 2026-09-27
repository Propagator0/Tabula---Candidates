"use client";

import { useEffect, useState, useRef } from "react";
import { useStore } from "@/lib/store";
import type { QueryResult, ExecutedStatement, QueryHistoryItem } from "@/lib/types";
import { formatSql } from "@/lib/sql-formatter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Play,
  Loader2,
  History,
  Trash2,
  CheckCircle2,
  XCircle,
  Clock,
  ChevronDown,
  ChevronUp,
  Download,
  Copy,
  Wand2,
  Eraser,
} from "lucide-react";
import { toast } from "sonner";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const SNIPPETS = [
  { label: "List tables", sql: "SELECT name, type FROM sqlite_master WHERE type IN ('table','view') ORDER BY name;" },
  { label: "Table schema", sql: "SELECT * FROM pragma_table_info('users');" },
  { label: "Row counts", sql: "SELECT name, (SELECT COUNT(*) FROM pragma_table_info(m.name)) AS cols FROM sqlite_master m WHERE type='table';" },
  { label: "Foreign keys", sql: "SELECT m.name AS table_name, fk.* FROM sqlite_master m JOIN pragma_foreign_key_list(m.name) fk WHERE m.type='table';" },
];

export function QueryEditor() {
  const { activeDatabaseId, setLastQuery, queryResult, setQueryResult, history, setHistory } = useStore();
  const [sql, setSql] = useState("SELECT name, type FROM sqlite_master WHERE type IN ('table','view');\n");
  const [loading, setLoading] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Load history on mount
  useEffect(() => {
    if (!activeDatabaseId) return;
    fetch(`/api/databases/${activeDatabaseId}/history?limit=50`)
      .then((r) => r.json())
      .then((d) => setHistory(d.history || []));
  }, [activeDatabaseId, setHistory]);

  const run = async () => {
    if (!activeDatabaseId || !sql.trim()) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/databases/${activeDatabaseId}/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sql }),
      });
      const data: QueryResult = await res.json();
      if (!res.ok) {
        toast.error((data as unknown as { error?: string }).error || "Query failed");
      }
      setQueryResult(data);
      const rowCount = data.statements.reduce(
        (acc, s) => acc + (s.rows?.length ?? 0),
        0
      );
      setLastQuery({
        ok: data.ok,
        durationMs: data.totalDurationMs,
        rowCount,
      });
      // refresh history
      const hres = await fetch(`/api/databases/${activeDatabaseId}/history?limit=50`);
      const hdata = await hres.json();
      setHistory(hdata.history || []);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      run();
    }
    // Tab inserts spaces
    if (e.key === "Tab") {
      e.preventDefault();
      const ta = e.currentTarget as HTMLTextAreaElement;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const next = sql.slice(0, start) + "  " + sql.slice(end);
      setSql(next);
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + 2;
      });
    }
  };

  const clearHistory = async () => {
    await fetch(`/api/databases/${activeDatabaseId}/history`, { method: "DELETE" });
    setHistory([]);
    toast.success("History cleared");
  };

  const exportResult = (stmt: ExecutedStatement) => {
    if (!stmt.rows?.length) return;
    const cols = stmt.columns ?? Object.keys(stmt.rows[0]);
    const escape = (v: unknown) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [cols.join(","), ...stmt.rows.map((r) => cols.map((c) => escape(r[c])).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "query-result.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Editor */}
      <div className="border-b bg-muted/10">
        <div className="flex items-center justify-between px-3 py-1.5 border-b bg-muted/20">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-mono text-muted-foreground">SQL</span>
            <Badge variant="outline" className="text-[9px] h-4">⌘/Ctrl + Enter</Badge>
          </div>
          <div className="flex items-center gap-1">
            <TooltipProvider delayDuration={400}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7"
                    onClick={() => {
                      if (!sql.trim()) return;
                      try {
                        setSql(formatSql(sql));
                        toast.success("SQL formatted");
                      } catch (e) {
                        toast.error("Format failed: " + (e as Error).message);
                      }
                    }}
                  >
                    <Wand2 className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Beautify SQL</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <TooltipProvider delayDuration={400}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7"
                    onClick={() => setSql("")}
                  >
                    <Eraser className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Clear editor</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <Button
              size="sm"
              variant="ghost"
              className="h-7"
              onClick={() => setShowHistory((s) => !s)}
            >
              <History className="h-3.5 w-3.5 mr-1" /> History
              {showHistory ? <ChevronUp className="h-3 w-3 ml-0.5" /> : <ChevronDown className="h-3 w-3 ml-0.5" />}
            </Button>
            <Button size="sm" onClick={run} disabled={loading} className="h-7">
              {loading ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Play className="h-3.5 w-3.5 mr-1" />}
              Run
            </Button>
          </div>
        </div>
        <textarea
          ref={taRef}
          value={sql}
          onChange={(e) => setSql(e.target.value)}
          onKeyDown={onKeyDown}
          spellCheck={false}
          className="w-full h-40 resize-y bg-transparent px-3 py-2 font-mono text-[13px] leading-relaxed outline-none scroll-thin"
          placeholder="-- Write SQL here. Multiple statements separated by ; are supported."
        />
        <div className="flex items-center gap-1 px-3 py-1 border-t bg-muted/20 overflow-x-auto scroll-thin">
          <span className="text-[10px] text-muted-foreground mr-1 whitespace-nowrap">Snippets:</span>
          {SNIPPETS.map((s) => (
            <button
              key={s.label}
              onClick={() => setSql(s.sql)}
              className="text-[10px] px-1.5 py-0.5 rounded bg-muted hover:bg-accent whitespace-nowrap font-mono"
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 min-h-0 flex">
        {/* Results */}
        <div className={`flex-1 min-w-0 flex flex-col ${showHistory ? "border-r" : ""}`}>
          <ResultsPanel result={queryResult} loading={loading} exportResult={exportResult} />
        </div>

        {/* History */}
        {showHistory && (
          <div className="w-72 shrink-0 flex flex-col bg-muted/10">
            <div className="flex items-center justify-between px-3 py-2 border-b">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                History
              </span>
              <Button size="icon" variant="ghost" className="h-6 w-6" onClick={clearHistory}>
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
            <ScrollArea className="flex-1">
              <div className="p-1.5 space-y-1">
                {history.length === 0 && (
                  <p className="text-xs text-muted-foreground p-3 text-center">
                    No queries yet.
                  </p>
                )}
                {history.map((h) => (
                  <HistoryItem
                    key={h.id}
                    item={h}
                    onClick={() => setSql(h.query)}
                  />
                ))}
              </div>
            </ScrollArea>
          </div>
        )}
      </div>
    </div>
  );
}

function ResultsPanel({
  result,
  loading,
  exportResult,
}: {
  result: QueryResult | null;
  loading: boolean;
  exportResult: (s: ExecutedStatement) => void;
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }
  if (!result) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
        <Play className="h-8 w-8 opacity-30" />
        <p className="text-sm">Run a query to see results.</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto scroll-thin">
      <div className="px-3 py-1.5 border-b bg-muted/20 flex items-center gap-3 text-[11px] font-mono sticky top-0 bg-card z-10">
        {result.ok ? (
          <Badge className="chip-text h-4 text-[9px]">
            <CheckCircle2 className="h-2.5 w-2.5 mr-0.5" /> OK
          </Badge>
        ) : (
          <Badge variant="destructive" className="h-4 text-[9px]">
            <XCircle className="h-2.5 w-2.5 mr-0.5" /> Error
          </Badge>
        )}
        <span className="text-muted-foreground">{result.statements.length} statement(s)</span>
        <span className="text-muted-foreground">{result.totalDurationMs}ms</span>
      </div>
      <div className="divide-y">
        {result.statements.map((stmt, i) => (
          <StatementResult key={i} stmt={stmt} index={i} exportResult={exportResult} />
        ))}
      </div>
    </div>
  );
}

function StatementResult({
  stmt,
  index,
  exportResult,
}: {
  stmt: ExecutedStatement;
  index: number;
  exportResult: (s: ExecutedStatement) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div>
      <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/10 hover:bg-muted/20">
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="flex items-center gap-1.5 flex-1 min-w-0 text-left"
        >
          {collapsed ? (
            <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
          ) : (
            <ChevronUp className="h-3 w-3 text-muted-foreground shrink-0" />
          )}
          <span className="text-[10px] font-mono text-muted-foreground shrink-0">#{index + 1}</span>
          <code className="text-[11px] font-mono truncate flex-1">
            {stmt.sql.length > 120 ? stmt.sql.slice(0, 120) + "…" : stmt.sql}
          </code>
        </button>
        <div className="flex items-center gap-2 shrink-0">
          {stmt.error ? (
            <Badge variant="destructive" className="h-4 text-[9px]">error</Badge>
          ) : stmt.type === "select" ? (
            <Badge variant="outline" className="h-4 text-[9px]">{stmt.rows?.length ?? 0} rows</Badge>
          ) : (
            <Badge variant="outline" className="h-4 text-[9px]">{stmt.changes ?? 0} changes</Badge>
          )}
          <span className="text-[10px] text-muted-foreground font-mono">{stmt.durationMs}ms</span>
          {stmt.rows && stmt.rows.length > 0 && (
            <Button size="icon" variant="ghost" className="h-5 w-5" onClick={() => exportResult(stmt)}>
              <Download className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>
      {!collapsed && (
        <div className="px-3 pb-3">
          {stmt.error ? (
            <pre className="text-[11px] font-mono text-destructive bg-destructive/5 border border-destructive/20 rounded p-2 whitespace-pre-wrap">
              {stmt.error}
            </pre>
          ) : stmt.type === "select" && stmt.rows ? (
            <ResultTable rows={stmt.rows} columns={stmt.columns} />
          ) : (
            <p className="text-[11px] text-muted-foreground font-mono py-2">
              {stmt.changes ?? 0} row(s) affected.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function ResultTable({
  rows,
  columns,
}: {
  rows: Record<string, unknown>[];
  columns?: string[];
}) {
  const cols = columns ?? (rows.length ? Object.keys(rows[0]) : []);
  if (rows.length === 0) {
    return <p className="text-[11px] text-muted-foreground font-mono py-2">Empty result set.</p>;
  }
  return (
    <div className="border rounded-md overflow-auto scroll-thin max-h-80">
      <table className="w-full text-[11px] font-mono border-collapse">
        <thead className="sticky top-0 bg-muted/60">
          <tr>
            {cols.map((c) => (
              <th key={c} className="text-left border-b border-r px-2 py-1 font-semibold whitespace-nowrap">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="hover:bg-muted/30">
              {cols.map((c) => (
                <td key={c} className="border-r px-2 py-0.5 align-top max-w-[320px] truncate">
                  {row[c] == null ? (
                    <span className="text-muted-foreground italic">NULL</span>
                  ) : (
                    String(row[c])
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HistoryItem({
  item,
  onClick,
}: {
  item: QueryHistoryItem;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left p-2 rounded hover:bg-accent/60 group"
    >
      <div className="flex items-center gap-1.5 mb-1">
        {item.success ? (
          <CheckCircle2 className="h-3 w-3 text-[var(--type-text)] shrink-0" />
        ) : (
          <XCircle className="h-3 w-3 text-destructive shrink-0" />
        )}
        <span className="text-[10px] text-muted-foreground font-mono flex items-center gap-1">
          <Clock className="h-2.5 w-2.5" />
          {new Date(item.executedAt).toLocaleTimeString()}
        </span>
        <span className="text-[10px] text-muted-foreground ml-auto">{item.durationMs}ms</span>
      </div>
      <code className="text-[10px] font-mono line-clamp-2 break-all opacity-80 group-hover:opacity-100">
        {item.query}
      </code>
    </button>
  );
}

// keep Copy import referenced
void Copy;
