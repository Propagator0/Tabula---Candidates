"use client";

import { useEffect, useState } from "react";
import { useStore, useActiveDatabase } from "@/lib/store";
import { DatabaseSidebar } from "@/components/database-sidebar";
import { StatusBar } from "@/components/status-bar";
import { AddDatabaseDialog } from "@/components/add-database-dialog";
import { CreateTableDialog } from "@/components/create-table-dialog";
import { TableDesigner } from "@/components/table-designer";
import { DataBrowser } from "@/components/data-browser";
import { QueryEditor } from "@/components/query-editor";
import { ErDiagramTab } from "@/components/er-diagram-tab";
import { OverviewTab } from "@/components/overview-tab";
import { SchemaToolsDialog } from "@/components/schema-tools-dialog";
import { CommandPalette } from "@/components/command-palette";
import { ShortcutsDialog, useGlobalShortcuts } from "@/components/shortcuts-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Network,
  Table2,
  Columns3,
  Terminal,
  X,
  Plus,
  Sun,
  Moon,
  Database,
  Github,
  Menu,
  ArrowDownUp,
  BarChart3,
} from "lucide-react";
import { useTheme } from "next-themes";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { type Tab } from "@/lib/types";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export function AppShell() {
  const {
    databases,
    activeDatabaseId,
    selectDatabase,
    setDatabases,
    schema,
    loadingSchema,
    tabs,
    activeTabId,
    setActiveTab,
    closeTab,
    openTab,
    refreshKey,
  } = useStore();
  const active = useActiveDatabase();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [mobileSidebar, setMobileSidebar] = useState(false);
  const [schemaToolsOpen, setSchemaToolsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const { shortcutsOpen, setShortcutsOpen } = useGlobalShortcuts({
    onOpenCommandPalette: () => setPaletteOpen(true),
    onOpenShortcuts: () => setShortcutsOpen(true),
    onExport: () => setSchemaToolsOpen(true),
    onGoEr: () => openTab("er"),
    onGoQuery: () => openTab("query"),
    onGoOverview: () => openTab("overview"),
  });

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  // Initial load of databases
  useEffect(() => {
    fetch("/api/databases")
      .then((r) => r.json())
      .then((d) => {
        setDatabases(d.databases || []);
        if (d.databases?.length && !activeDatabaseId) {
          selectDatabase(d.databases[0].id);
        }
      })
      .catch((e) => toast.error("Failed to load databases: " + (e as Error).message));
  }, []);

  // Load schema + layouts whenever active DB or refreshKey changes.
  useEffect(() => {
    if (!activeDatabaseId) return;
    const ctrl = new AbortController();
    (async () => {
      try {
        const res = await fetch(`/api/databases/${activeDatabaseId}`, {
          signal: ctrl.signal,
        });
        const data = await res.json();
        if (data.schema) {
          useStore.getState().setSchema(data.schema);
          useStore.getState().setTableLayouts(data.tableLayouts || []);
        }
      } catch (e) {
        if ((e as Error).name !== "AbortError") {
          toast.error((e as Error).message);
        }
      }
    })();
    return () => ctrl.abort();
  }, [activeDatabaseId, refreshKey]);

  // Ensure a default ER tab is open when a DB loads.
  useEffect(() => {
    if (activeDatabaseId && tabs.length === 0 && schema) {
      openTab("er");
    }
  }, [activeDatabaseId, schema]);

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;

  const renderTabContent = (tab: Tab) => {
    switch (tab.type) {
      case "er":
        return <ErDiagramTab />;
      case "overview":
        return <OverviewTab />;
      case "design":
        return tab.table ? <TableDesigner tableName={tab.table} /> : null;
      case "data":
        return tab.table ? <DataBrowser tableName={tab.table} /> : null;
      case "query":
        return <QueryEditor />;
      default:
        return null;
    }
  };

  return (
    <div className="flex flex-col h-screen bg-background text-foreground overflow-hidden">
      {/* Top bar */}
      <header className="h-12 shrink-0 border-b bg-sidebar flex items-center px-3 gap-3">
        <div className="flex items-center gap-2">
          {/* Mobile sidebar trigger */}
          <Sheet open={mobileSidebar} onOpenChange={setMobileSidebar}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 md:hidden">
                <Menu className="h-4 w-4" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 p-0">
              <DatabaseSidebar
                onAddDatabase={() => {
                  setMobileSidebar(false);
                  setAddOpen(true);
                }}
                onCreateTable={() => {
                  setMobileSidebar(false);
                  setCreateOpen(true);
                }}
              />
            </SheetContent>
          </Sheet>

          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-md bg-primary flex items-center justify-center shadow-sm">
              <Database className="h-4 w-4 text-primary-foreground" />
            </div>
            <div className="leading-none">
              <div className="font-semibold text-sm tracking-tight">Tabula</div>
              <div className="text-[9px] text-muted-foreground uppercase tracking-widest">
                SQLite Manager
              </div>
            </div>
          </div>
        </div>

        <div className="h-5 w-px bg-border mx-1 hidden sm:block" />

        {/* DB quick switch */}
        <div className="hidden md:flex items-center gap-1.5 min-w-0">
          {active ? (
            <Badge
              variant="secondary"
              className="gap-1.5 font-normal"
            >
              <span
                className="h-2 w-2 rounded-sm"
                style={{ backgroundColor: active.color }}
              />
              <span className="font-mono text-xs">{active.name}</span>
            </Badge>
          ) : (
            <span className="text-xs text-muted-foreground">No database selected</span>
          )}
          {databases.length > 1 && (
            <select
              value={activeDatabaseId ?? ""}
              onChange={(e) => selectDatabase(e.target.value)}
              className="text-xs bg-transparent border rounded px-1.5 py-0.5 outline-none cursor-pointer hover:bg-accent"
            >
              {databases.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-8"
            onClick={() => setCreateOpen(true)}
            disabled={!activeDatabaseId}
          >
            <Plus className="h-3.5 w-3.5 mr-1" /> Table
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8"
            onClick={() => openTab("query")}
            disabled={!activeDatabaseId}
          >
            <Terminal className="h-3.5 w-3.5 mr-1" /> Query
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8"
            onClick={() => openTab("overview")}
            disabled={!activeDatabaseId}
          >
            <BarChart3 className="h-3.5 w-3.5 mr-1" /> Overview
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8"
            onClick={() => setSchemaToolsOpen(true)}
            disabled={!activeDatabaseId}
          >
            <ArrowDownUp className="h-3.5 w-3.5 mr-1" /> Export
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8"
            onClick={() => setAddOpen(true)}
          >
            <Database className="h-3.5 w-3.5 mr-1" /> Add DB
          </Button>
          <div className="h-5 w-px bg-border mx-1" />
          <Button
            variant="outline"
            size="sm"
            className="h-8 hidden md:flex gap-1.5"
            onClick={() => setPaletteOpen(true)}
            title="Command palette (⌘K)"
          >
            <Terminal className="h-3.5 w-3.5" />
            <kbd className="text-[10px] font-mono font-semibold px-1 py-0.5 rounded bg-muted/60 border">⌘K</kbd>
          </Button>
          {mounted && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            >
              {theme === "dark" ? (
                <Sun className="h-4 w-4" />
              ) : (
                <Moon className="h-4 w-4" />
              )}
            </Button>
          )}
          <a
            href="https://www.sqlite.org/docs.html"
            target="_blank"
            rel="noreferrer"
            className="hidden sm:block"
          >
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <Github className="h-4 w-4" />
            </Button>
          </a>
        </div>
      </header>

      {/* Main split */}
      <div className="flex-1 min-h-0">
        <ResizablePanelGroup direction="horizontal">
          <ResizablePanel
            defaultSize={18}
            minSize={14}
            maxSize={32}
            className="hidden md:block"
          >
            <DatabaseSidebar
              onAddDatabase={() => setAddOpen(true)}
              onCreateTable={() => setCreateOpen(true)}
            />
          </ResizablePanel>
          <ResizableHandle className="hidden md:flex" />
          <ResizablePanel defaultSize={82}>
            <div className="flex flex-col h-full">
              {/* Tab strip */}
              <div className="h-9 shrink-0 border-b bg-muted/30 flex items-stretch overflow-x-auto scroll-thin">
                {tabs.length === 0 && (
                  <div className="flex items-center px-3 text-xs text-muted-foreground">
                    {activeDatabaseId
                      ? "Open a table or the schema map to begin"
                      : "Connect a database to begin"}
                  </div>
                )}
                {tabs.map((tab) => (
                  <TabButton
                    key={tab.id}
                    tab={tab}
                    active={tab.id === activeTabId}
                    onClick={() => setActiveTab(tab.id)}
                    onClose={() => closeTab(tab.id)}
                  />
                ))}
              </div>

              {/* Tab content */}
              <div className="flex-1 min-h-0 bg-background relative">
                {loadingSchema && (
                  <div className="absolute inset-0 flex items-center justify-center text-muted-foreground z-20 bg-background/40">
                    <div className="animate-pulse">Loading…</div>
                  </div>
                )}
                <div key={activeTab?.id ?? "empty"} className="h-full animate-fade-in">
                  {activeTab ? (
                    renderTabContent(activeTab)
                  ) : (
                    <EmptyState onOpenEr={() => openTab("er")} hasDb={!!activeDatabaseId} />
                  )}
                </div>
              </div>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      {/* Sticky footer */}
      <StatusBar />

      <AddDatabaseDialog open={addOpen} onOpenChange={setAddOpen} />
      <CreateTableDialog open={createOpen} onOpenChange={setCreateOpen} />
      <SchemaToolsDialog open={schemaToolsOpen} onOpenChange={setSchemaToolsOpen} />
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onOpenExport={() => setSchemaToolsOpen(true)}
        onOpenShortcuts={() => setShortcutsOpen(true)}
        onOpenAddDb={() => setAddOpen(true)}
        onOpenCreateTable={() => setCreateOpen(true)}
      />
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </div>
  );
}

function TabButton({
  tab,
  active,
  onClick,
  onClose,
}: {
  tab: Tab;
  active: boolean;
  onClick: () => void;
  onClose: () => void;
}) {
  const Icon =
    tab.type === "er"
      ? Network
      : tab.type === "design"
        ? Table2
        : tab.type === "data"
          ? Columns3
          : tab.type === "overview"
            ? BarChart3
            : Terminal;
  return (
    <div
      onClick={onClick}
      className={cn(
        "group flex items-center gap-1.5 pl-3 pr-1.5 border-r cursor-pointer text-xs select-none transition-colors shrink-0",
        active
          ? "bg-background text-foreground border-t-2 border-t-primary"
          : "text-muted-foreground hover:bg-muted/50 hover:text-foreground border-t-2 border-t-transparent"
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="font-mono truncate max-w-[140px]">{tab.title}</span>
      {tab.closable && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="ml-1 h-4 w-4 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-muted transition-opacity"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

function EmptyState({
  onOpenEr,
  hasDb,
}: {
  onOpenEr: () => void;
  hasDb: boolean;
}) {
  const features = [
    { icon: Network, label: "Visual ER diagram", desc: "Drag & relate" },
    { icon: Columns3, label: "Browse & edit data", desc: "Inline grid" },
    { icon: Terminal, label: "Run SQL", desc: "Multi-statement" },
    { icon: BarChart3, label: "Insights", desc: "Charts & stats" },
  ];
  return (
    <div className="flex flex-col items-center justify-center h-full text-center p-8 gap-6">
      <div className="h-20 w-20 rounded-2xl bg-primary/10 flex items-center justify-center shadow-sm ring-1 ring-primary/20">
        <Database className="h-10 w-10 text-primary" />
      </div>
      <div className="space-y-2">
        <h2 className="text-2xl font-semibold tracking-tight">Welcome to Tabula</h2>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          A free, visual SQLite database manager. Design schemas with a drag-and-drop
          ER diagram, browse and edit data, and run SQL — all in your browser.
        </p>
      </div>
      {hasDb ? (
        <div className="flex flex-col items-center gap-3">
          <Button size="lg" onClick={onOpenEr} className="h-10">
            <Network className="h-4 w-4 mr-2" /> Open schema map
          </Button>
          <p className="text-xs text-muted-foreground">
            Press{" "}
            <kbd className="font-mono text-[10px] font-semibold px-1 py-0.5 rounded bg-muted/60 border">⌘K</kbd>{" "}
            for the command palette, or{" "}
            <kbd className="font-mono text-[10px] font-semibold px-1 py-0.5 rounded bg-muted/60 border">?</kbd>{" "}
            for shortcuts.
          </p>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Click <span className="font-semibold">Add DB</span> in the top bar to connect a SQLite file.
        </p>
      )}
      {hasDb && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4 max-w-2xl">
          {features.map((f) => (
            <div
              key={f.label}
              className="rounded-lg border bg-card p-3 flex flex-col items-center gap-1.5 text-center hover:shadow-sm hover:-translate-y-0.5 transition-all"
            >
              <f.icon className="h-5 w-5 text-primary" />
              <div className="text-xs font-medium">{f.label}</div>
              <div className="text-[10px] text-muted-foreground">{f.desc}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
"use client";

    import { useEffect, useState } from "react";
    import { useStore, useActiveDatabase } from "@/lib/store";
    import { DatabaseSidebar } from "@/components/database-sidebar";
    import { StatusBar } from "@/components/status-bar";
    import { AddDatabaseDialog } from "@/components/add-database-dialog";
    import { CreateTableDialog } from "@/components/create-table-dialog";
    import { TableDesigner } from "@/components/table-designer";
    import { DataBrowser } from "@/components/data-browser";
    import { QueryEditor } from "@/components/query-editor";
    import { ErDiagramTab } from "@/components/er-diagram-tab";
    import { OverviewTab } from "@/components/overview-tab";
    import { SchemaToolsDialog } from "@/components/schema-tools-dialog";
    import { CommandPalette } from "@/components/command-palette";
    import { ShortcutsDialog, useGlobalShortcuts } from "@/components/shortcuts-dialog";
    import { Button } from "@/components/ui/button";
    import { Badge } from "@/components/ui/badge";
    import {
      Sheet,
      SheetContent,
      SheetTrigger,
    } from "@/components/ui/sheet";
    import {
      Network,
      Table2,
      Columns3,
      Terminal,
      X,
      Plus,
      Sun,
      Moon,
      Database,
      Github,
      Menu,
      ArrowDownUp,
      BarChart3,
    } from "lucide-react";
    import { useTheme } from "next-themes";
    import {
      ResizableHandle,
      ResizablePanel,
      ResizablePanelGroup,
    } from "@/components/ui/resizable";
    import { type Tab } from "@/lib/types";
    import { toast } from "sonner";
    import { cn } from "@/lib/utils";

    export function AppShell() {
      const {
        databases,
        activeDatabaseId,
        selectDatabase,
        setDatabases,
        schema,
        loadingSchema,
        tabs,
        activeTabId,
        setActiveTab,
        closeTab,
        openTab,
        refreshKey,
      } = useStore();
      const active = useActiveDatabase();
      const { theme, setTheme } = useTheme();
      const [mounted, setMounted] = useState(false);
      const [addOpen, setAddOpen] = useState(false);
      const [createOpen, setCreateOpen] = useState(false);
      const [mobileSidebar, setMobileSidebar] = useState(false);
      const [schemaToolsOpen, setSchemaToolsOpen] = useState(false);
      const [paletteOpen, setPaletteOpen] = useState(false);

      const { shortcutsOpen, setShortcutsOpen } = useGlobalShortcuts({
        onOpenCommandPalette: () => setPaletteOpen(true),
                                                                     onOpenShortcuts: () => setShortcutsOpen(true),
                                                                     onExport: () => setSchemaToolsOpen(true),
                                                                     onGoEr: () => openTab("er"),
                                                                     onGoQuery: () => openTab("query"),
                                                                     onGoOverview: () => openTab("overview"),
      });

      useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setMounted(true);
      }, []);

      // Initial load of databases
      useEffect(() => {
        fetch("/api/databases")
        .then((r) => r.json())
        .then((d) => {
          setDatabases(d.databases || []);
          if (d.databases?.length && !activeDatabaseId) {
            selectDatabase(d.databases[0].id);
          }
        })
        .catch((e) => toast.error("Failed to load databases: " + (e as Error).message));
      }, []);

      // Load schema + layouts whenever active DB or refreshKey changes.
      useEffect(() => {
        if (!activeDatabaseId) return;
        const ctrl = new AbortController();
        (async () => {
          try {
            const res = await fetch(`/api/databases/${activeDatabaseId}`, {
              signal: ctrl.signal,
            });
            const data = await res.json();
            if (data.schema) {
              useStore.getState().setSchema(data.schema);
              useStore.getState().setTableLayouts(data.tableLayouts || []);
            }
          } catch (e) {
            if ((e as Error).name !== "AbortError") {
              toast.error((e as Error).message);
            }
          }
        })();
        return () => ctrl.abort();
      }, [activeDatabaseId, refreshKey]);

      // Ensure a default ER tab is open when a DB loads.
      useEffect(() => {
        if (activeDatabaseId && tabs.length === 0 && schema) {
          openTab("er");
        }
      }, [activeDatabaseId, schema]);

      const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;

      const renderTabContent = (tab: Tab) => {
        switch (tab.type) {
          case "er":
            return <ErDiagramTab />;
          case "overview":
            return <OverviewTab />;
          case "design":
            return tab.table ? <TableDesigner tableName={tab.table} /> : null;
          case "data":
            return tab.table ? <DataBrowser tableName={tab.table} /> : null;
          case "query":
            return <QueryEditor />;
          default:
            return null;
        }
      };

      return (
        <div className="flex flex-col h-screen bg-background text-foreground overflow-hidden">
        {/* Top bar */}
        <header className="h-12 shrink-0 border-b bg-sidebar flex items-center px-3 gap-3">
        <div className="flex items-center gap-2">
        {/* Mobile sidebar trigger */}
        <Sheet open={mobileSidebar} onOpenChange={setMobileSidebar}>
        <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8 md:hidden">
        <Menu className="h-4 w-4" />
        </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-72 p-0">
        <DatabaseSidebar
        onAddDatabase={() => {
          setMobileSidebar(false);
          setAddOpen(true);
        }}
        onCreateTable={() => {
          setMobileSidebar(false);
          setCreateOpen(true);
        }}
        />
        </SheetContent>
        </Sheet>

        <div className="flex items-center gap-2">
        <div className="h-7 w-7 rounded-md bg-primary flex items-center justify-center shadow-sm">
        <Database className="h-4 w-4 text-primary-foreground" />
        </div>
        <div className="leading-none">
        <div className="font-semibold text-sm tracking-tight">Tabula</div>
        <div className="text-[9px] text-muted-foreground uppercase tracking-widest">
        SQLite Manager
        </div>
        </div>
        </div>
        </div>

        <div className="h-5 w-px bg-border mx-1 hidden sm:block" />

        {/* DB quick switch */}
        <div className="hidden md:flex items-center gap-1.5 min-w-0">
        {active ? (
          <Badge
          variant="secondary"
          className="gap-1.5 font-normal"
          >
          <span
          className="h-2 w-2 rounded-sm"
          style={{ backgroundColor: active.color }}
          />
          <span className="font-mono text-xs">{active.name}</span>
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground">No database selected</span>
        )}
        {databases.length > 1 && (
          <select
          value={activeDatabaseId ?? ""}
          onChange={(e) => selectDatabase(e.target.value)}
          className="text-xs bg-transparent border rounded px-1.5 py-0.5 outline-none cursor-pointer hover:bg-accent"
          >
          {databases.map((d) => (
            <option key={d.id} value={d.id}>
            {d.name}
            </option>
          ))}
          </select>
        )}
        </div>

        <div className="ml-auto flex items-center gap-1">
        <Button
        variant="ghost"
        size="sm"
        className="h-8"
        onClick={() => setCreateOpen(true)}
        disabled={!activeDatabaseId}
        >
        <Plus className="h-3.5 w-3.5 mr-1" /> Table
        </Button>
        <Button
        variant="ghost"
        size="sm"
        className="h-8"
        onClick={() => openTab("query")}
        disabled={!activeDatabaseId}
        >
        <Terminal className="h-3.5 w-3.5 mr-1" /> Query
        </Button>
        <Button
        variant="ghost"
        size="sm"
        className="h-8"
        onClick={() => openTab("overview")}
        disabled={!activeDatabaseId}
        >
        <BarChart3 className="h-3.5 w-3.5 mr-1" /> Overview
        </Button>
        <Button
        variant="ghost"
        size="sm"
        className="h-8"
        onClick={() => setSchemaToolsOpen(true)}
        disabled={!activeDatabaseId}
        >
        <ArrowDownUp className="h-3.5 w-3.5 mr-1" /> Export
        </Button>
        <Button
        variant="ghost"
        size="sm"
        className="h-8"
        onClick={() => setAddOpen(true)}
        >
        <Database className="h-3.5 w-3.5 mr-1" /> Add DB
        </Button>
        <div className="h-5 w-px bg-border mx-1" />
        <Button
        variant="outline"
        size="sm"
        className="h-8 hidden md:flex gap-1.5"
        onClick={() => setPaletteOpen(true)}
        title="Command palette (⌘K)"
        >
        <Terminal className="h-3.5 w-3.5" />
        <kbd className="text-[10px] font-mono font-semibold px-1 py-0.5 rounded bg-muted/60 border">⌘K</kbd>
        </Button>
        {mounted && (
          <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
          {theme === "dark" ? (
            <Sun className="h-4 w-4" />
          ) : (
            <Moon className="h-4 w-4" />
          )}
          </Button>
        )}
        <a
        href="https://www.sqlite.org/docs.html"
        target="_blank"
        rel="noreferrer"
        className="hidden sm:block"
        >
        <Button variant="ghost" size="icon" className="h-8 w-8">
        <Github className="h-4 w-4" />
        </Button>
        </a>
        </div>
        </header>

        {/* Main split */}
        <div className="flex-1 min-h-0">
        <ResizablePanelGroup direction="horizontal">
        <ResizablePanel
        defaultSize={18}
        minSize={14}
        maxSize={32}
        className="hidden md:block"
        >
        <DatabaseSidebar
        onAddDatabase={() => setAddOpen(true)}
        onCreateTable={() => setCreateOpen(true)}
        />
        </ResizablePanel>
        <ResizableHandle className="hidden md:flex" />
        <ResizablePanel defaultSize={82}>
        <div className="flex flex-col h-full">
        {/* Tab strip */}
        <div className="h-9 shrink-0 border-b bg-muted/30 flex items-stretch overflow-x-auto scroll-thin">
        {tabs.length === 0 && (
          <div className="flex items-center px-3 text-xs text-muted-foreground">
          {activeDatabaseId
            ? "Open a table or the schema map to begin"
            : "Connect a database to begin"}
            </div>
        )}
        {tabs.map((tab) => (
          <TabButton
          key={tab.id}
          tab={tab}
          active={tab.id === activeTabId}
          onClick={() => setActiveTab(tab.id)}
          onClose={() => closeTab(tab.id)}
          />
        ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 min-h-0 bg-background relative">
        {loadingSchema && (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground z-20 bg-background/40">
          <div className="animate-pulse">Loading…</div>
          </div>
        )}
        <div key={activeTab?.id ?? "empty"} className="h-full animate-fade-in">
        {activeTab ? (
          renderTabContent(activeTab)
        ) : (
          <EmptyState onOpenEr={() => openTab("er")} hasDb={!!activeDatabaseId} />
        )}
        </div>
        </div>
        </div>
        </ResizablePanel>
        </ResizablePanelGroup>
        </div>

        {/* Sticky footer */}
        <StatusBar />

        <AddDatabaseDialog open={addOpen} onOpenChange={setAddOpen} />
        <CreateTableDialog open={createOpen} onOpenChange={setCreateOpen} />
        <SchemaToolsDialog open={schemaToolsOpen} onOpenChange={setSchemaToolsOpen} />
        <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onOpenExport={() => setSchemaToolsOpen(true)}
        onOpenShortcuts={() => setShortcutsOpen(true)}
        onOpenAddDb={() => setAddOpen(true)}
        onOpenCreateTable={() => setCreateOpen(true)}
        />
        <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
        </div>
      );
    }

    function TabButton({
      tab,
      active,
      onClick,
      onClose,
    }: {
      tab: Tab;
      active: boolean;
      onClick: () => void;
      onClose: () => void;
    }) {
      const Icon =
      tab.type === "er"
      ? Network
      : tab.type === "design"
      ? Table2
      : tab.type === "data"
      ? Columns3
      : tab.type === "overview"
      ? BarChart3
      : Terminal;
      return (
        <div
        onClick={onClick}
        className={cn(
          "group flex items-center gap-1.5 pl-3 pr-1.5 border-r cursor-pointer text-xs select-none transition-colors shrink-0",
          active
          ? "bg-background text-foreground border-t-2 border-t-primary"
          : "text-muted-foreground hover:bg-muted/50 hover:text-foreground border-t-2 border-t-transparent"
        )}
        >
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span className="font-mono truncate max-w-[140px]">{tab.title}</span>
        {tab.closable && (
          <button
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="ml-1 h-4 w-4 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-muted transition-opacity"
          >
          <X className="h-3 w-3" />
          </button>
        )}
        </div>
      );
    }

    function EmptyState({
      onOpenEr,
      hasDb,
    }: {
      onOpenEr: () => void;
      hasDb: boolean;
    }) {
      const features = [
        { icon: Network, label: "Visual ER diagram", desc: "Drag & relate" },
        { icon: Columns3, label: "Browse & edit data", desc: "Inline grid" },
        { icon: Terminal, label: "Run SQL", desc: "Multi-statement" },
        { icon: BarChart3, label: "Insights", desc: "Charts & stats" },
      ];
      return (
        <div className="flex flex-col items-center justify-center h-full text-center p-8 gap-6">
        <div className="h-20 w-20 rounded-2xl bg-primary/10 flex items-center justify-center shadow-sm ring-1 ring-primary/20">
        <Database className="h-10 w-10 text-primary" />
        </div>
        <div className="space-y-2">
        <h2 className="text-2xl font-semibold tracking-tight">Welcome to Tabula</h2>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
        A free, visual SQLite database manager. Design schemas with a drag-and-drop
        ER diagram, browse and edit data, and run SQL — all in your browser.
        </p>
        </div>
        {hasDb ? (
          <div className="flex flex-col items-center gap-3">
          <Button size="lg" onClick={onOpenEr} className="h-10">
          <Network className="h-4 w-4 mr-2" /> Open schema map
          </Button>
          <p className="text-xs text-muted-foreground">
          Press{" "}
          <kbd className="font-mono text-[10px] font-semibold px-1 py-0.5 rounded bg-muted/60 border">⌘K</kbd>{" "}
          for the command palette, or{" "}
          <kbd className="font-mono text-[10px] font-semibold px-1 py-0.5 rounded bg-muted/60 border">?</kbd>{" "}
          for shortcuts.
            </p>
            </div>
        ) : (
          <p className="text-xs text-muted-foreground">
          Click <span className="font-semibold">Add DB</span> in the top bar to connect a SQLite file.
          </p>
        )}
        {hasDb && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4 max-w-2xl">
          {features.map((f) => (
            <div
            key={f.label}
            className="rounded-lg border bg-card p-3 flex flex-col items-center gap-1.5 text-center hover:shadow-sm hover:-translate-y-0.5 transition-all"
            >
            <f.icon className="h-5 w-5 text-primary" />
            <div className="text-xs font-medium">{f.label}</div>
            <div className="text-[10px] text-muted-foreground">{f.desc}</div>
            </div>
          ))}
          </div>
        )}
        </div>
      );
    }
