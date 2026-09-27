"use client";

import { create } from "zustand";
import type {
  ManagedDatabase,
  DatabaseSchema,
  TableLayout,
  Tab,
  TabType,
  QueryResult,
  QueryHistoryItem,
} from "./types";

interface TabState {
  // Data
  databases: ManagedDatabase[];
  activeDatabaseId: string | null;
  schema: DatabaseSchema | null;
  tableLayouts: TableLayout[];
  loadingSchema: boolean;

  // Tabs
  tabs: Tab[];
  activeTabId: string | null;

  // Last query result (for the status bar)
  lastQuery: { ok: boolean; durationMs: number; rowCount: number } | null;

  // Bump to signal a schema/data refresh is needed.
  refreshKey: number;

  // Actions
  setDatabases: (dbs: ManagedDatabase[]) => void;
  selectDatabase: (id: string) => void;
  setSchema: (schema: DatabaseSchema | null) => void;
  setTableLayouts: (layouts: TableLayout[]) => void;
  upsertLayout: (layout: TableLayout) => void;
  setLoadingSchema: (v: boolean) => void;
  openTab: (type: TabType, opts?: { table?: string; title?: string }) => void;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  setLastQuery: (q: { ok: boolean; durationMs: number; rowCount: number } | null) => void;
  setRefreshKey: () => void;

  // Cached query history per db
  history: QueryHistoryItem[];
  setHistory: (h: QueryHistoryItem[]) => void;

  // Cached last query result for the query tab
  queryResult: QueryResult | null;
  setQueryResult: (r: QueryResult | null) => void;
}

let tabSeq = 0;
function makeTabId() {
  tabSeq += 1;
  return `tab-${Date.now()}-${tabSeq}`;
}

export const useStore = create<TabState>((set, get) => ({
  databases: [],
  activeDatabaseId: null,
  schema: null,
  tableLayouts: [],
  loadingSchema: false,
  tabs: [],
  activeTabId: null,
  lastQuery: null,
  history: [],
  queryResult: null,
  refreshKey: 0,

  setDatabases: (dbs) => set({ databases: dbs }),

  selectDatabase: (id) => {
    set({ activeDatabaseId: id, schema: null, tableLayouts: [], tabs: [], activeTabId: null, history: [], queryResult: null });
  },

  setSchema: (schema) => set({ schema }),
  setTableLayouts: (layouts) => set({ tableLayouts: layouts }),
  upsertLayout: (layout) => {
    const existing = get().tableLayouts;
    const idx = existing.findIndex((l) => l.tableName === layout.tableName);
    if (idx >= 0) {
      const next = [...existing];
      next[idx] = { ...next[idx], ...layout };
      set({ tableLayouts: next });
    } else {
      set({ tableLayouts: [...existing, layout] });
    }
  },
  setLoadingSchema: (v) => set({ loadingSchema: v }),

  openTab: (type, opts) => {
    const state = get();
    // For table-scoped tabs, reuse an existing tab on the same table+type.
    if (opts?.table) {
      const existing = state.tabs.find(
        (t) => t.type === type && t.table === opts.table
      );
      if (existing) {
        set({ activeTabId: existing.id });
        return;
      }
    }
    // ER diagram and Overview are singletons.
    if (type === "er" || type === "overview") {
      const existing = state.tabs.find((t) => t.type === type);
      if (existing) {
        set({ activeTabId: existing.id });
        return;
      }
    }
    const title =
      opts?.title ??
      (type === "er"
        ? "Schema Map"
        : type === "query"
          ? "Query"
          : type === "history"
            ? "History"
            : type === "overview"
              ? "Overview"
              : opts?.table ?? "Tab");
    const tab: Tab = {
      id: makeTabId(),
      type,
      title,
      table: opts?.table,
      closable: type !== "er",
    };
    set({ tabs: [...state.tabs, tab], activeTabId: tab.id });
  },

  closeTab: (id) => {
    const state = get();
    const idx = state.tabs.findIndex((t) => t.id === id);
    if (idx < 0) return;
    const next = state.tabs.filter((t) => t.id !== id);
    let nextActive = state.activeTabId;
    if (state.activeTabId === id) {
      nextActive = next.length ? next[Math.max(0, idx - 1)].id : null;
    }
    set({ tabs: next, activeTabId: nextActive });
  },

  setActiveTab: (id) => set({ activeTabId: id }),
  setLastQuery: (q) => set({ lastQuery: q }),
  setHistory: (h) => set({ history: h }),
  setQueryResult: (r) => set({ queryResult: r }),
  setRefreshKey: () => set((s) => ({ refreshKey: s.refreshKey + 1 })),
}));

/** Convenience hook for the active database object. */
export function useActiveDatabase() {
  return useStore((s) =>
    s.databases.find((d) => d.id === s.activeDatabaseId) ?? null
  );
}
