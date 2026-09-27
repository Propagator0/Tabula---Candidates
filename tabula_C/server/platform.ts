// The desktop glue: where Tabula keeps its own state, how it shows a native
// file picker without Electron, and how it opens its window.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

// ------------------------------------------------------------------- state
// Recent files and table positions live in ~/.local/state/tabula/state.json.
// Never in your database: Tabula doesn't add tables to files it opens.

type Layout = { tables: Record<string, [number, number]> };
type State = { recent: string[]; layouts: Record<string, Layout> };

const stateDir = join(process.env.XDG_STATE_HOME || join(homedir(), ".local", "state"), "tabula");
const stateFile = join(stateDir, "state.json");

function readState(): State {
  try { const s = JSON.parse(readFileSync(stateFile, "utf8")); return { recent: s.recent ?? [], layouts: s.layouts ?? {} }; }
  catch { return { recent: [], layouts: {} }; }
}
function writeState(s: State) {
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(stateFile + ".tmp", JSON.stringify(s, null, 1));
  renameSync(stateFile + ".tmp", stateFile);                          // atomic: a crash never leaves half a file
}

export const store = {
  recent(): string[] { return readState().recent.filter(p => existsSync(p)); },
  touch(path: string) { const s = readState(); s.recent = [path, ...s.recent.filter(p => p !== path)].slice(0, 12); writeState(s); },
  layout(path: string): Layout { return readState().layouts[path] ?? { tables: {} }; },
  saveLayout(path: string, layout: Layout) { const s = readState(); s.layouts[path] = layout; writeState(s); },
};

export function expandPath(p: string): string {
  p = p.trim();
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  return resolve(p);
}

// ----------------------------------------------------------------- dialogs
// kdialog is part of Plasma, zenity covers GNOME and most others. If neither
// exists, the UI falls back to its own path field.

export function dialogTools() { return { kdialog: !!Bun.which("kdialog"), zenity: !!Bun.which("zenity") }; }

export async function pickFile(mode: "open" | "new", startDir: string): Promise<{ path: string | null; unsupported?: boolean }> {
  let cmd: string[] | null = null;
  const title = mode === "open" ? "Open SQLite database" : "New SQLite database";
  if (Bun.which("kdialog")) {
    cmd = ["kdialog", "--title", title, mode === "open" ? "--getopenfilename" : "--getsavefilename", startDir,
      "*.db *.sqlite *.sqlite3 *.db3|SQLite databases\n*|All files"];
  } else if (Bun.which("zenity")) {
    cmd = ["zenity", "--file-selection", "--title=" + title, "--filename=" + startDir + "/",
      "--file-filter=SQLite databases | *.db *.sqlite *.sqlite3 *.db3", "--file-filter=All files | *",
      ...(mode === "new" ? ["--save", "--confirm-overwrite"] : [])];
  }
  if (!cmd) return { path: null, unsupported: true };
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "ignore", stdin: "ignore" });
  const out = (await new Response(proc.stdout).text()).trim();
  return { path: (await proc.exited) === 0 && out ? out : null };      // non-zero exit = Cancel
}

// ------------------------------------------------------------------ window
// Chromium-family browsers get --app: a window with no tabs or address bar.
// Set TABULA_BROWSER to override, e.g. TABULA_BROWSER=brave.

const APP_BROWSERS = ["chromium", "brave", "brave-browser", "google-chrome-stable", "google-chrome", "vivaldi-stable", "microsoft-edge-stable"];

export function openWindow(url: string): string {
  const pick = process.env.TABULA_BROWSER?.trim();
  let cmd: string[];
  if (pick) {
    const parts = pick.split(/\s+/);
    cmd = /chrom|brave|vivaldi|edge/i.test(parts[0]) ? [...parts, "--app=" + url] : [...parts, url];
  } else {
    const app = APP_BROWSERS.find(b => Bun.which(b));
    if (app) cmd = [app, "--app=" + url, "--window-size=1440,900"];
    else if (Bun.which("firefox")) cmd = ["firefox", "--new-window", url];
    else cmd = ["xdg-open", url];
  }
  try { Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore", stdin: "ignore" }).unref(); }
  catch { return "none found: open the URL above yourself"; }         // spawn throws if the command doesn't exist
  return cmd[0];
}
