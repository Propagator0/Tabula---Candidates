#!/usr/bin/env bun
// Tabula's backend: a tiny HTTP server on 127.0.0.1 that owns the SQLite
// connection and serves the UI. The browser window is only a view.
//
//   bun server/main.ts [file.db] [--port N] [--open] [--idle-exit]
//
// Security, in plain terms. Any web page you visit can SEND requests to
// 127.0.0.1 (it just can't read the answers). Without protection, a hostile
// page could POST "DROP TABLE users" to this server. So:
//   1. every /api request must carry a secret token in a custom header. The
//      token is generated at startup and written into the page Tabula serves;
//      other sites can't read that page, so they never learn it. A custom
//      header also forces the browser to ask permission first (CORS
//      preflight), which this server never grants.
//   2. the Host header must be 127.0.0.1 or localhost, which defeats DNS
//      rebinding (a hostile domain pointed at 127.0.0.1).
//   3. the page's Content-Security-Policy only allows loading from this
//      server, so the UI is fully offline and can't phone out.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, normalize, sep } from "node:path";
import { homedir } from "node:os";
import { Session, TabulaError, type Op } from "./session";
import { dialogTools, expandPath, openWindow, pickFile, store } from "./platform";

const WEB = join(import.meta.dir, "..", "web");
const args = process.argv.slice(2);
const flag = (f: string) => args.includes(f);
const opt = (f: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const positional = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1] === "--port"));

const token = crypto.randomUUID();
let session: Session | null = null;
let lastSeen = Date.now();

function openDb(path: string, create: boolean) {
  const next = Session.open(expandPath(path), create);
  session?.close();
  session = next;
  store.touch(session.path);
}
if (positional[0]) {
  try { openDb(positional[0], false); }
  catch (e) { console.error("tabula: " + (e as Error).message); process.exit(1); }
}

const payload = () => session
  ? { db: session.info(), schema: session.schema(), layout: store.layout(session.path) }
  : { db: null, schema: null, layout: null };
const need = () => { if (!session) throw new TabulaError("No database is open."); return session; };

// ------------------------------------------------------------------ routes
type Handler = (body: any) => unknown | Promise<unknown>;
const api: Record<string, Handler> = {
  "GET state": () => ({ ...payload(), recent: store.recent(), dialogs: dialogTools(), home: homedir() }),
  "GET schema": () => payload(),
  "GET poll": () => (session ? { schemaVersion: session.schemaVersion(), dataVersion: session.dataVersion() } : {}),
  "GET counts": () => ({ counts: need().counts(), db: need().info() }),
  "POST open": b => { openDb(String(b.path ?? ""), !!b.create); return { ...payload(), recent: store.recent() }; },
  "POST close": () => { session?.close(); session = null; return { ...payload(), recent: store.recent() }; },
  "POST dialog": b => pickFile(b.mode === "new" ? "new" : "open", session ? dirname(session.path) : homedir()),
  "POST rows": b => need().rows(String(b.table), Number(b.offset) || 0, Number(b.limit) || 200),
  "POST cell": b => need().updateCell(String(b.table), String(b.column), b.key, b.value),
  "POST row": b => need().insertDefault(String(b.table)),
  "POST delete": b => need().deleteRow(String(b.table), b.key),
  "POST sql": b => { const r = need().sql(String(b.sql ?? "")); return { ...r, db: need().info() }; }, 
  "POST apply": b => {
    const s = need();
    const r = s.migrate(b.ops as Op[], b.baseSchemaVersion ?? null, !b.dryRun);
    return b.dryRun ? r : { ...r, ...payload() };
  },
  "POST pragma": b => {
    const s = need();
    if (b.journal) s.setJournal(String(b.journal));
    if (typeof b.fk === "boolean") s.setForeignKeys(b.fk);
    return { db: s.info() };
  },
  "POST integrity": () => need().integrity(),
  "POST vacuum": () => { const r = need().vacuum(); return { ...r, db: need().info() }; },
  "POST layout": b => { store.saveLayout(need().path, { tables: b.tables ?? {} }); return { ok: true }; },
  "POST quit": () => { setTimeout(shutdown, 50); return { ok: true }; },
};

// ------------------------------------------------------------------ server
const port = Number(opt("--port") ?? 0);
let allowedHosts = new Set<string>();

const server = Bun.serve({
  hostname: "127.0.0.1",
  port,
  async fetch(req) {
    const url = new URL(req.url);
    if (!allowedHosts.has(req.headers.get("host") ?? "")) return new Response("Wrong host", { status: 421 });

    if (url.pathname.startsWith("/api/")) {
      const name = url.pathname.slice(5);
      if (name === "bye") {                                          // sendBeacon on window close; can't set headers
        if (url.searchParams.get("t") === token) scheduleByeExit();
        return new Response(null, { status: 204 });
      }
      if (req.headers.get("x-tabula-token") !== token) return json({ error: "forbidden" }, 403);
      lastSeen = Date.now();
      const h = api[req.method + " " + name];
      if (!h) return json({ error: "no such endpoint: " + name }, 404);
      try {
        const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
        return json(await h(body));
      } catch (e) {
        const extra = e instanceof TabulaError ? e.extra : {};
        return json({ error: (e as Error).message, ...extra }, 400);
      }
    }
    return serveStatic(url.pathname);
  },
});
const base = `http://127.0.0.1:${server.port}/`;
allowedHosts = new Set([`127.0.0.1:${server.port}`, `localhost:${server.port}`]);

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'";
const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8" };

function serveStatic(pathname: string) {
  if (pathname === "/" || pathname === "/index.html") {
    // The dc runtime's own template parser reads this page, so the token goes in as a plain script tag in <head>.
    const resources = {
      "https://unpkg.com/react@18.3.1/umd/react.production.min.js": "/react.production.min.js",
      "https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js": "/react-dom.production.min.js",
    };
    const html = readFileSync(join(WEB, "Tabula.dc.html"), "utf8")
      .replace("<head>", `<head>\n<script>window.TABULA = ${JSON.stringify({ token })}; window.__resources = ${JSON.stringify(resources)};</script>`);
    return new Response(html, { headers: { "content-type": TYPES[".html"], "content-security-policy": CSP, "cache-control": "no-store" } });
  }
  const file = normalize(join(WEB, decodeURIComponent(pathname)));
  if (!file.startsWith(WEB + sep) || !existsSync(file)) return new Response("Not found", { status: 404 });
  const ext = file.slice(file.lastIndexOf("."));
  return new Response(Bun.file(file), { headers: { "content-type": TYPES[ext] ?? "application/octet-stream" } });
}

// --------------------------------------------------------------- lifecycle
// With --idle-exit (the launcher sets it), closing the window stops the
// server: the page says "bye" as it closes, and if no page checks in within
// a few seconds (a reload does), the server exits. The 3-minute fallback
// covers a crashed window; minimized windows still poll about once a minute.

function scheduleByeExit() {
  if (!flag("--idle-exit")) return;
  const at = Date.now();
  setTimeout(() => { if (lastSeen < at) shutdown(); }, 4000);
}
if (flag("--idle-exit")) setInterval(() => { if (Date.now() - lastSeen > 180_000) shutdown(); }, 10_000);

function shutdown() {
  session?.close();                                                  // closing checkpoints the WAL
  server.stop(true);
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.log(`tabula  ${base}${session ? "  ·  " + session.path : ""}`);
if (flag("--open")) console.log("window  " + openWindow(base));
