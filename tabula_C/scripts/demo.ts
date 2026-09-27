// Builds the database from the mockup, for real: same seven tables, the two
// views, the trigger, the six indexes, and roughly the same row counts.
//
//   bun scripts/demo.ts [path]        default: ./demo/tasks.db

import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";

export const DEMO_SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA user_version = 14;
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT,
  password_hash TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE sessions (
  id TEXT PRIMARY KEY NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  user_agent TEXT
);
CREATE TABLE projects (
  id INTEGER PRIMARY KEY,
  owner_id INTEGER NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE tasks (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  assignee_id INTEGER REFERENCES users (id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  body TEXT,
  status TEXT NOT NULL DEFAULT 'todo',
  priority INTEGER NOT NULL DEFAULT 2,
  due_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE comments (
  id INTEGER PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  author_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE task_tags (
  task_id INTEGER NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, tag_id)
) WITHOUT ROWID;
CREATE TABLE tags (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  color TEXT
);
CREATE INDEX idx_tasks_project ON tasks (project_id);
CREATE INDEX idx_tasks_assignee_status ON tasks (assignee_id, status);
CREATE INDEX idx_tasks_due ON tasks (due_at);
CREATE INDEX idx_comments_task ON comments (task_id);
CREATE INDEX idx_sessions_user ON sessions (user_id);
CREATE INDEX idx_sessions_expires ON sessions (expires_at);
CREATE VIEW v_open_tasks AS
  SELECT t.id, t.title, t.status, t.priority, p.slug AS project
  FROM tasks t JOIN projects p ON p.id = t.project_id
  WHERE t.status <> 'done';
CREATE VIEW v_project_stats AS
  SELECT p.slug, count(t.id) AS tasks, sum(t.status = 'done') AS done
  FROM projects p LEFT JOIN tasks t ON t.project_id = p.id GROUP BY p.id;
CREATE TRIGGER trg_comments_touch_task AFTER INSERT ON comments
BEGIN
  UPDATE tasks SET status = CASE WHEN status = 'todo' THEN 'doing' ELSE status END
  WHERE id = NEW.task_id;
END;
`;

export function buildDemo(path: string, scale = 1) {
  if (existsSync(path)) for (const s of ["", "-wal", "-shm"]) rmSync(path + s, { force: true });
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true });
  db.run(DEMO_SCHEMA);

  let seed = 7;
  // Math.imul: seed * 1103515245 overflows 2^53 as a float and the sequence degenerates into repeats
  const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32);
  const pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length)];
  const hex = (n: number) => Array.from({ length: n }, () => "0123456789abcdef"[Math.floor(rnd() * 16)]).join("");
  const day = (d: number) => new Date(Date.UTC(2025, 0, 1) + d * 86400000 + Math.floor(rnd() * 86400000)).toISOString().slice(0, 19).replace("T", " ");
  const N = (n: number) => Math.max(8, Math.round(n * scale));

  const FIRST = ["ada", "linus", "grace", "ken", "margaret", "dennis", "barbara", "edsger", "frances", "alan", "radia", "donald", "hedy", "john", "sophie", "tim"];
  const LAST = ["lovelace", "torvalds", "hopper", "thompson", "hamilton", "ritchie", "liskov", "dijkstra", "allen", "kay", "perlman", "knuth", "lamarr", "backus", "wilson", "berners-lee"];
  const VERB = ["Migrate", "Fix", "Profile", "Paginate", "Index", "Remove", "Retry", "Document", "Cache", "Split", "Harden", "Vacuum"];
  const NOUN = ["auth hashes", "WAL checkpoint stall", "CSV export", "comments endpoint", "nightly backup", "legacy v1 routes", "webhook deliveries", "project list query", "settings page", "FTS5 title search", "session sweeper", "rate limiter"];
  const SAY = ["repro attached", "needs design review", "blocked on infra", "ready for review", "EXPLAIN QUERY PLAN shows a full scan", "shipping behind a flag", "restore tested on a fresh box", "cursor-based, not OFFSET"];

  db.transaction(() => {
    const users = N(1284), projects = N(212), tasks = N(18402), tags = 38;
    const u = db.prepare("INSERT INTO users (id, email, display_name, password_hash, is_admin, created_at) VALUES (?, ?, ?, ?, ?, ?)");
    for (let i = 1; i <= users; i++) {
      const f = pick(FIRST), l = pick(LAST);
      u.run(i, `${f}.${l}.${i}@tally.dev`, rnd() < 0.08 ? null : `${f[0].toUpperCase() + f.slice(1)} ${l[0].toUpperCase() + l.slice(1)}`,
        "$argon2id$v=19$m=65536,t=3,p=4$" + hex(22), i <= 3 ? 1 : 0, day(i % 400));
    }
    const s = db.prepare("INSERT INTO sessions VALUES (?, ?, ?, ?)");
    const UA = ["Firefox/131.0 (X11; Linux x86_64)", "curl/8.10.1", "Chromium/129 (X11; Linux x86_64)", "tally-cli/0.9.2", null];
    for (let i = 0; i < N(3107); i++) s.run(hex(32), 1 + Math.floor(rnd() * users), day(400 + (i % 90)), pick(UA));
    const p = db.prepare("INSERT INTO projects (id, owner_id, name, slug, archived, created_at) VALUES (?, ?, ?, ?, ?, ?)");
    for (let i = 1; i <= projects; i++) p.run(i, 1 + Math.floor(rnd() * users), `Project ${i}`, `project-${i}`, rnd() < 0.1 ? 1 : 0, day(i));
    const g = db.prepare("INSERT INTO tags (id, name, color) VALUES (?, ?, ?)");
    const TAG = ["bug", "perf", "db", "ux", "infra", "good-first-issue", "docs", "security"];
    for (let i = 1; i <= tags; i++) g.run(i, i <= TAG.length ? TAG[i - 1] : `tag-${i}`, rnd() < 0.3 ? null : "#" + hex(6));
    const t = db.prepare("INSERT INTO tasks (id, project_id, assignee_id, title, body, status, priority, due_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
    const ST = ["todo", "doing", "done", "done", "blocked"];
    for (let i = 1; i <= tasks; i++) {
      t.run(4100 + i, 1 + Math.floor(rnd() * projects), rnd() < 0.15 ? null : 1 + Math.floor(rnd() * users),
        `${pick(VERB)} ${pick(NOUN)}`, rnd() < 0.3 ? null : pick(SAY), pick(ST), 1 + Math.floor(rnd() * 3), rnd() < 0.25 ? null : day(300 + (i % 200)).slice(0, 10), day(i % 380));
    }
    const c = db.prepare("INSERT INTO comments (task_id, author_id, body, created_at) VALUES (?, ?, ?, ?)");
    for (let i = 0; i < N(40961); i++) c.run(4101 + Math.floor(rnd() * tasks), 1 + Math.floor(rnd() * users), pick(SAY) + ".", day(i % 390));
    const tt = db.prepare("INSERT OR IGNORE INTO task_tags VALUES (?, ?)");
    for (let i = 0; i < N(23000); i++) tt.run(4101 + Math.floor(rnd() * tasks), 1 + Math.floor(rnd() * tags));
  })();
  db.run("PRAGMA wal_checkpoint(TRUNCATE)");
  db.close();
}

if (import.meta.main) {
  const out = resolve(process.argv[2] ?? "demo/tasks.db");
  buildDemo(out);
  console.log("wrote " + out);
}
