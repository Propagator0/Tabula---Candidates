// Splits a SQL script into single statements.
//
// Why this exists: bun:sqlite's prepare() compiles only the FIRST statement
// of a string and silently ignores the rest. "SELECT 1; DROP TABLE x" would
// run the SELECT and quietly skip the DROP. So every script is cut into
// statements here and each one is prepared on its own.
//
// The hard part is CREATE TRIGGER: its body holds semicolons that do NOT end
// the statement ("BEGIN ...; ...; END;"). Inside a trigger we count
// BEGIN/END, and CASE/END pairs so a CASE expression's END isn't mistaken
// for the end of the body.

export type Stmt = { sql: string; start: number };

export function splitSql(src: string): Stmt[] {
  const out: Stmt[] = [];
  let start = 0, i = 0;
  const n = src.length;
  let head: string[] = [];          // first words of the current statement
  let trigger = false, body = false, caseDepth = 0;
  let word = "";

  const endWord = () => {
    if (!word) return;
    const w = word.toUpperCase(); word = "";
    if (head.length < 3) {
      head.push(w);
      if (head[0] === "CREATE" && (head[1] === "TRIGGER" || (head[2] === "TRIGGER" && /^TEMP(ORARY)?$/.test(head[1])))) trigger = true;
    }
    if (!trigger) return;
    if (w === "BEGIN" && !body) body = true;
    else if (w === "CASE") caseDepth++;
    else if (w === "END") { if (caseDepth > 0) caseDepth--; else if (body) body = false; }
  };
  const push = (end: number) => {
    // drop comments that sit BEFORE the statement; they belong to nothing
    const sql = src.slice(start, end).replace(/^(\s*(--[^\n]*(\n|$)|\/\*[\s\S]*?\*\/))*/, "").trim();
    if (sql && stripComments(sql).trim()) out.push({ sql, start });
    start = end + 1; head = []; trigger = false; body = false; caseDepth = 0;
  };

  while (i < n) {
    const ch = src[i];
    if (/[A-Za-z0-9_$]/.test(ch)) { word += ch; i++; continue; }
    endWord();
    if (ch === "'" || ch === '"' || ch === "`") {          // quoted: '' "" `` escapes by doubling
      i++;
      while (i < n) { if (src[i] === ch) { if (src[i + 1] === ch) { i += 2; continue; } break; } i++; }
      i++; continue;
    }
    if (ch === "[") { while (i < n && src[i] !== "]") i++; i++; continue; }
    if (ch === "-" && src[i + 1] === "-") { while (i < n && src[i] !== "\n") i++; continue; }
    if (ch === "/" && src[i + 1] === "*") { const e = src.indexOf("*/", i + 2); i = e < 0 ? n : e + 2; continue; }
    if (ch === ";" && !(trigger && body)) { push(i); i++; continue; }
    i++;
  }
  endWord();
  push(n);
  return out;
}

export function stripComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

// Upper-cased bare words of a statement, with strings, quoted identifiers
// and comments removed. Used to spot clauses like CHECK or COLLATE.
export function bareWords(sql: string): string[] {
  return stripComments(sql)
    .replace(/'(?:[^']|'')*'/g, " ")
    .replace(/"(?:[^"]|"")*"/g, " ")
    .replace(/`(?:[^`]|``)*`/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .toUpperCase()
    .match(/[A-Z_][A-Z0-9_$]*/g) ?? [];
}
