# Tabula

curl -fsSL https://bun.sh/install | bash

export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"

bun --version

bun install
bun run demo

sqlite3 demo/tasks.db

bun server/main.ts ./demo/tasks.db --port 4317


bun scripts/demo.ts demo/tasks.db && bun server/main.ts demo/tasks.db --open --idle-exit





A local-first visual SQLite workbench for Linux. Tabula opens the **real database file** through a small Bun backend and presents a desktop-style schema canvas in a Chromium/Firefox window.

## What works

- Open or create `.db`, `.sqlite`, `.sqlite3`, and `.db3` files with a native `kdialog`/`zenity` picker
- Live schema introspection: tables, columns, PKs, single-column FKs, indexes, views, triggers, STRICT, and WITHOUT ROWID
- ER diagram with pan, zoom, minimap, persisted positions, relationship highlighting, and auto-layout
- Visual schema edits with undo/redo and generated migration SQL
- Transactional migration apply with stale-schema detection, rollback, foreign-key checks, view validation, and `user_version` increments
- Row browser with safe cell updates, inserts, and deletes using bound parameters
- Multi-statement SQL console, including trigger-aware SQL splitting and a 2,000-row result cap
- Integrity check, `VACUUM`, journal details, foreign-key toggle, schema/migration export
- 64-bit integers are preserved; BLOBs are summarized rather than shoved through JSON
- Offline UI: React is vendored, and the server uses a restrictive Content Security Policy

## Requirements (EndeavourOS / Arch)

1. [Bun](https://bun.sh/) 1.1 or newer
2. A browser: Chromium/Brave/Vivaldi gives the cleanest app window; Firefox also works
3. Optional: `kdialog` (KDE Plasma) or `zenity` for native file dialogs

```bash
curl -fsSL https://bun.sh/install | bash
# Restart the shell, or add ~/.bun/bin to PATH.
```

Tabula has no npm install step and no runtime package download.

## Run

```bash
chmod +x tabula install.sh
./tabula ~/path/to/app.db
```

With no path, Tabula opens to an empty workspace and the **Open** button launches a file picker.

Useful server-only form:

```bash
bun server/main.ts ~/path/to/app.db --port 4317
```

## Install in the desktop menu

```bash
./install.sh
```

This creates `~/.local/bin/tabula`, a desktop entry, and an icon. It does not copy the project, so keep this directory where it is.

## Demo database

```bash
bun run demo
./tabula demo/tasks.db
```

The generator creates a realistic seven-table database with views, a trigger, indexes, and enough rows to exercise the data browser.

## Safety model

Tabula listens only on `127.0.0.1` and validates the `Host` header. Every API request must carry a random startup token injected into the served page. The browser UI is locked to the local origin with CSP and cannot load remote scripts, fonts, or data.

Schema changes run under `BEGIN IMMEDIATE`. Tabula checks the schema version before applying, rolls back on any error, verifies new foreign-key violations, and compiles every view before commit. It refuses visual rebuilds for schema details the canvas cannot represent safely (such as CHECK constraints, generated columns, or composite foreign keys); use the SQL console for those cases.

Edits made through the data grid and SQL console are live immediately. Visual schema edits remain pending until **Apply** is pressed.

## Project layout

- `server/main.ts` — local HTTP server, API, lifecycle, static assets
- `server/session.ts` — live SQLite connection, rows, SQL, migrations, maintenance
- `server/introspect.ts` — loss-aware schema introspection
- `server/sqlsplit.ts` — trigger-aware SQL statement splitter
- `server/platform.ts` — dialogs, browser launcher, recent files, diagram layout storage
- `web/Tabula.dc.html` — the complete visual app
- `scripts/demo.ts` — demo database generator

## Keyboard

`Ctrl+O` open · `Ctrl+S` acknowledge live save · `T` new table · `Delete` drop selected table/row · `L` auto-layout · `F` fit · `Ctrl+Enter` run SQL · `Ctrl+J` bottom panel · `?` all shortcuts
