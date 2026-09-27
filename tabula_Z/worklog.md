# Tabula — Visual SQLite Manager · Worklog

A DBSchema-inspired, web-based GUI to manage SQLite databases visually.
Built with Next.js 16, better-sqlite3, Prisma, shadcn/ui.

---
Task ID: 1
Agent: main (orchestrator)
Task: Foundation — install better-sqlite3, set up Prisma schema, create SQLite lib helpers, seed a demo database.

Work Log:
- Installed `better-sqlite3@13` + `@types/better-sqlite3`.
- Authored `prisma/schema.prisma` with `ManagedDatabase`, `TableLayout`, `QueryHistory` models; ran `bun run db:push`.
- Created `src/lib/sqlite.ts` with connection caching, schema introspection, paginated data fetch, and a tokenizer-based `splitSql()` multi-statement executor that respects comments / string literals / BEGIN...END blocks.
- Seeded a demo database at `db/demo.sqlite` with `users`, `posts`, `comments`, `tags`, `post_tags` tables, foreign keys, and sample rows so the UI has content on first load.

Stage Summary:
- SQLite layer is complete and reusable across all API routes.
- A connection cache keyed by absolute file path keeps opened DBs warm.
- `executeScript` returns per-statement results (rows/columns/changes/duration) which the query editor UI will render.
- Demo DB registered automatically on first app boot via a seed step.

---
Task ID: 4
Agent: full-stack-developer (ER diagram canvas)
Task: Build the visual ER-diagram canvas component (`src/components/er-diagram.tsx`) — a DBSchema-style schema layout view with pan/zoom, draggable table cards, and SVG bezier relationship lines between FK and PK columns.

Work Log:
- Read shared `worklog.md` and `src/lib/types.ts` to align with the prop contract (`DatabaseSchema`, `TableLayout`, helper functions `typeTextClass`/`typeTintClass`) and existing styling tokens in `globals.css`.
- Inspected available shadcn/ui `Button` and `Tooltip` component APIs to match import signatures.
- Authored `src/components/er-diagram.tsx` as a `"use client"` component implementing:
  - Pan (pointer drag on background) + zoom (wheel toward cursor, clamped 0.4x–2x) via a single CSS `transform: translate() scale()` on a "world" wrapper. State-mirror refs (kept in sync through `useEffect`) let the non-passive wheel listener read fresh pan/zoom without re-binding.
  - Floating toolbar (top-left) with zoom-in, zoom-out, fit-to-view, auto-layout, save buttons using lucide icons (`ZoomIn`, `ZoomOut`, `Maximize2`, `LayoutGrid`, `Save`) inside a `bg-card/80 backdrop-blur border shadow-sm` container, plus a `100%`-style zoom-level badge. Each button wrapped in `Tooltip` with `aria-label`.
  - Draggable table cards (220px wide): header with `Table2`/`Eye` icon, `font-mono` table name, row-count badge, `bg-primary/10` tint; column rows with `KeyRound` (tint-pk) for PK, `Link2` (tint-fk) for FK, and `typeTextClass(type)`-colored type label on the right. Cards use pointer events with `setPointerCapture`, screen→world delta conversion by dividing by zoom, and a <4px movement threshold to distinguish click from drag. Hover raises z-index and ring.
  - SVG relationship overlay inside the world (1×1 box, `overflow: visible`, `pointer-events: none`), drawing cubic beziers between FK column centers on the child table and the referenced column on the parent table. Edge selection (left/right) is chosen based on relative card centers so lines don't wrap unnecessarily. An `auto-start-reverse` arrow marker at the parent (PK) end uses `var(--type-fk)`. A wider invisible hit-area path on top enables hover (stroke 1.5→3, opacity 0.5→0.9).
  - `fitToView` computes the bounding box of all card layouts and centers/scales them within the container with 60px padding.
  - Empty state with `Database` icon, "No tables yet" heading, and a muted hint when `schema.tables.length === 0`.
- Exported both as named `ErDiagram` and default export.
- Ran `bun run lint`; fixed a `react-hooks/refs` error (cannot update ref during render) by moving ref-mirroring writes into `useEffect`. Final lint shows 0 errors in the new file (the 4 remaining warnings are pre-existing in `src/lib/sqlite.ts`).
- Verified dev server log shows clean compilation with no errors from the new component.

Stage Summary:
- Produced `src/components/er-diagram.tsx` — a self-contained, dependency-free ER canvas (React 19 + TS + Tailwind v4 + lucide + shadcn Button/Tooltip only).
- Honors the exact prop contract: `{ schema, layouts, onLayoutChange, onSaveLayouts, onTableClick, autoLayout }`.
- All world-space coordinates; single transformed wrapper; performant for ~20 tables via `useMemo` for `tableMap`, `layoutMap`, `relationships`, and `relPaths`.
- Named + default export ready for the main layout shell to import.

---
Task ID: 2-7
Agent: main (orchestrator)
Task: Backend API routes + full frontend (shell, sidebar, ER diagram tab, table designer, data browser, query editor, dialogs) + end-to-end verification.

Work Log:
- Built 9 API routes under /api/databases/[id]/...: list/register DBs, get/delete/patch DB, full schema introspection, tables list+create, single table get/delete/rename/truncate, paginated data (GET/POST/PUT/DELETE rows), SQL query execution with per-statement results, query history, and ER layout persistence (GET/PUT).
- Authored src/lib/api-helpers.ts (resolveManagedDatabase + errorResponse) to share DB resolution across routes.
- Customized globals.css with a warm amber-on-charcoal theme (light + dark), type-tint tokens (integer/text/real/blob/pk/fk), grid/dot backgrounds, and thin scrollbars.
- Added next-themes provider; layout.tsx defaults to dark theme.
- Built shared types (src/lib/types.ts) and Zustand store (src/lib/store.ts) with databases/schema/tabs/layouts/history state + refreshKey.
- Frontend components: app-shell (top bar + resizable sidebar + tab strip + sticky footer), database-sidebar (DB list + expandable table tree with column previews), status-bar (sticky footer), add-database-dialog, create-table-dialog (full column editor with FK picker), table-designer (columns/indexes/DDL + rename/truncate), data-browser (paginated grid, inline edit, insert/delete, WHERE filter, CSV export, sortable columns), query-editor (multi-statement SQL with per-statement results, snippets, history sidebar, Ctrl+Enter), er-diagram-tab (wires layout load/save + auto-layout).
- Dispatched subagent (Task 4) for the ER diagram canvas: pan/zoom, draggable table cards, SVG bezier relationship lines with arrowheads + hover hit-areas, floating toolbar, fit-to-view, empty state.
- Fixed two backend introspection bugs: AUTOINCREMENT now only marks the PK column (was marking all columns), and added UNIQUE detection via single-column unique indexes.
- Fixed lucide-react import error (`Index` -> `Layers`) and all lint issues (set-state-in-effect, unused disables, comma expressions).

Stage Summary:
- Full-stack app verified end-to-end with agent-browser:
  * Demo Blog DB auto-registers with 5 tables on boot.
  * ER diagram renders 5 table cards + 8 relationship paths (4 FKs x visible+hitarea).
  * Data browser shows real rows (users: Ada/Grace/Linus/Alan) with pagination + filter + insert/delete/edit affordances.
  * Query editor runs multi-statement SQL; JOIN query returned a proper result table.
  * Table designer shows columns with correct PK/A_I/UNIQUE/NOT NULL badges, indexes, and DDL.
  * Status bar footer is sticky; lint passes clean; dev log shows no runtime errors.
- Tech notes: better-sqlite3 runs inside the Next.js/Node server (works); the seed script uses bun:sqlite because better-sqlite3 crashes under Bun's NAPI runtime.

---
Task ID: 8 (cron review round 1)
Agent: main (orchestrator) — webDevReview
Task: QA existing features via agent-browser, then add schema export/import, SQL formatter, overview dashboard, command palette + keyboard shortcuts, and styling polish.

Work Log:
- QA pass: verified ER diagram (5 cards + 8 relationship paths), data browser (4 users with pagination/filter/edit), query editor (multi-statement + error reporting), table designer (PK/A_I/UNIQUE/NOT NULL badges), Add DB + Create Table dialogs, sticky footer. All functional; lint clean; dev log clean.
- Feature: Schema export — `GET /api/databases/[id]/export` returns a full DDL dump (tables, views, triggers, optional INSERT data) as a `.sql` file, or JSON. Verified the endpoint produces a valid, importable dump.
- Feature: Schema import — `POST /api/databases/[id]/import` executes an arbitrary SQL script against the DB via the existing tokenizer-based `executeScript`, persists a history entry, and returns per-statement results + change count.
- Feature: SQL formatter — `src/lib/sql-formatter.ts` (dependency-free tokenizer) uppercases keywords/functions, breaks before major clauses (SELECT/FROM/JOIN/WHERE/GROUP BY/ORDER BY/LIMIT/VALUES), indents multi-column SELECT and VALUES lists, preserves string literals and comments. Tested with SELECT/JOIN, INSERT...VALUES, CREATE TABLE — produces clean output.
- UI: Schema Tools dialog (`schema-tools-dialog.tsx`) with Export/Import tabs, include-data toggle, copy-export-url, download .sql / .json, paste-to-import textarea.
- UI: Query editor toolbar gains a Format (Wand2) button + Clear (Eraser) button with tooltips. Verified: lowercased `select ... count(...) ... order by ... desc` → `SELECT … COUNT(…) … ORDER BY … DESC` with proper line breaks.
- Feature: Overview dashboard tab (`overview-tab.tsx`) with 6 stat cards (tables/views/triggers/total rows/columns/file size), a "Rows per table" bar chart + "Column types" pie chart (recharts), a tables list with PK/FK badges + row counts, a keys & relations panel (PK/FK counts + recent queries), and a database pragmas grid. Verified: 5 bar rects + 2 pie slices render for the demo DB.
- Feature: Command palette (`command-palette.tsx`) using cmdk — ⌘/Ctrl+K opens it; Navigate group (Schema Map / Overview / Query), Actions group (Create table / Add DB / Export-Import / Toggle theme / Shortcuts), and a "Tables in <db>" group listing every table for quick data/structure access. Verified: opens via Ctrl+K, selecting "Go to Overview" navigates correctly.
- Feature: Keyboard shortcuts — `shortcuts-dialog.tsx` with a `useGlobalShortcuts` hook wiring `?` (help), `e` (export), `g` then `m`/`q`/`o` (nav), `⌘K` (palette). Shortcuts dialog lists all shortcuts grouped by Query / Global / Navigation. Verified: `?` keydown opens the shortcuts dialog.
- UI wiring: app-shell top bar gains Overview and Export buttons + a ⌘K command-palette button (with kbd hint). Overview added as a new `TabType` singleton in the store.
- Styling polish: ER cards get a gradient accent strip (primary for tables, type-text→chart-2 for views), smoother hover (-translate-y-0.5 + shadow-lg + ring), scale on drag, NOT NULL dot indicator on column rows, row separators. globals.css gains `bg-grid-fine`, `animate-fade-in`, `shimmer` skeleton, and focus-visible ring utilities. Tab content fades in on switch. Empty state redesigned with feature cards + ⌘K/? hints.

Stage Summary:
- Four major new features shipped & verified end-to-end with agent-browser: schema export/import, SQL beautify, overview dashboard with charts, command palette + keyboard shortcuts.
- Styling polish round complete: ER cards, transitions, empty state, focus rings, animations.
- All new code passes `bun run lint` clean; dev log shows no runtime errors.
- Screenshots saved to /home/z/my-project/screenshots/qa-*.png documenting each feature.
- Next opportunities: keyboard shortcut for sidebar toggle (⌘B), row-count sparkline in sidebar tree, query plan/explain view, drag-to-create relationship on the ER canvas, light-mode visual refinements.
