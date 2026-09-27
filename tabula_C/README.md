# Tabula

A visual schema editor for SQLite. Draws a database as tables and relations,
lets you edit it on the canvas, and turns the edits into migration SQL you can
read before anything touches the file.

## Run it

```sh
bun run demo                  # builds the database from the mockup (demo/tasks.db) and opens it
bin/tabula ~/some/file.db     # open any SQLite file
bin/tabula                    # start empty; File › Open… (Ctrl+O)
scripts/install.sh            # `tabula` on your PATH + a Plasma launcher entry
bun test                      # 19 tests against real SQLite files
```

Needs only Bun (https://bun.sh, or AUR `bun-bin`). No `npm install`: SQLite is
built into Bun, and React and the Geist fonts ship in `web/vendor/`. The page
loads nothing from the internet.

The window opens as a Chromium-family `--app` window (chromium, brave,
chrome, vivaldi, edge, in that order). Pick one with `TABULA_BROWSER=brave`.
Closing the window stops the server a few seconds later.

## How it fits together

```
server/main.ts        HTTP on 127.0.0.1 only; token + Host checks on every API call
server/session.ts     the one SQLite connection: rows, SQL console, migrations, VACUUM
server/introspect.ts  reads the live schema into what the canvas can draw
server/sqlsplit.ts    cuts scripts into statements (bun:sqlite only runs the first)
server/platform.ts    kdialog/zenity file picker, browser window, ~/.local/state/tabula
web/Tabula.dc.html    the UI: your design, now driven by the server
```

## What Apply does

The Changes tab shows every statement. Apply runs all of them in ONE transaction:

1. `foreign_keys` off (it has to be switched outside the transaction)
2. the ops: renames first, so SQLite rewrites views, triggers and foreign keys
   that mention the old names; then adds, drops and rebuilds
3. a rebuild re-creates the table's triggers (SQLite deletes them with the table)
   and keeps hidden rowids and the AUTOINCREMENT counter
4. every view must still compile, and no new foreign key may be broken
5. `user_version` + 1, COMMIT, `foreign_keys` back to what it was

If any step fails, everything rolls back and the error names the op. **Dry run**
does all of it and then rolls back on purpose.

## What it refuses

Some SQLite features have no place on the canvas: CHECK, COLLATE, generated
columns, multi-column UNIQUE, composite foreign keys, partial or expression
indexes, virtual tables. A table that has any of them is *rebuild-protected*:
renames and plain added or dropped columns still work (SQLite does those and keeps
everything), but edits that would need a rebuild are blocked, because a rebuild
recreates the table from the canvas and would silently lose those parts.

## Small print

- `foreign_keys` in the Database panel is a per-connection setting: it changes
  Tabula's session, not the file.
- Table positions and recent files live in `~/.local/state/tabula/state.json`.
  Tabula never adds anything to your database except `user_version`.
- If another program changes the schema while you have unapplied edits, Apply
  refuses and asks you to reload rather than overwrite their change.
