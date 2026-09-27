/**
 * A small, dependency-free SQL formatter/beautifier.
 *
 * Handles:
 *  - Uppercasing of SQL keywords (with a curated list)
 *  - Consistent indentation (2 spaces per level)
 *  - Breaking before major clauses (SELECT, FROM, WHERE, JOIN, GROUP BY,
 *    ORDER BY, LIMIT, etc.) onto their own indented line
 *  - Multiline column lists inside SELECT and VALUES
 *  - Preserving string literals and comments
 *
 * It is intentionally conservative: it reformats whitespace/keywords but does
 * not re-order or rewrite the SQL itself, so it's safe for arbitrary input.
 */

const KEYWORDS = new Set([
  "SELECT", "FROM", "WHERE", "INSERT", "INTO", "VALUES", "UPDATE", "SET",
  "DELETE", "CREATE", "TABLE", "VIEW", "INDEX", "TRIGGER", "DROP", "ALTER",
  "ADD", "RENAME", "TO", "COLUMN", "PRIMARY", "KEY", "FOREIGN", "REFERENCES",
  "UNIQUE", "NOT", "NULL", "DEFAULT", "CHECK", "AUTOINCREMENT", "ON",
  "CONFLICT", "CASCADE", "RESTRICT", "BEGIN", "END", "COMMIT", "ROLLBACK",
  "JOIN", "INNER", "LEFT", "RIGHT", "FULL", "OUTER", "CROSS", "USING",
  "GROUP", "BY", "ORDER", "HAVING", "LIMIT", "OFFSET", "AS", "DISTINCT",
  "AND", "OR", "IN", "BETWEEN", "LIKE", "IS", "EXISTS", "CASE", "WHEN",
  "THEN", "ELSE", "UNION", "ALL", "INTERSECT", "EXCEPT", "WITH",
  "RECURSIVE", "PRAGMA", "EXPLAIN", "QUERY", "PLAN", "ANALYZE", "ATTACH",
  "DETACH", "VACUUM", "REINDEX", "IF", "EXISTS", "TEMP", "TEMPORARY",
  "ASC", "DESC", "ESCAPE", "COLLATE", "NOCASE", "BINARY", "RTRIM",
  // Functions (uppercased for consistency)
  "COUNT", "SUM", "AVG", "MIN", "MAX", "TOTAL", "GROUP_CONCAT",
  "COALESCE", "NULLIF", "IFNULL", "IIF", "CAST", "TYPEOF", "LENGTH",
  "LOWER", "UPPER", "SUBSTR", "TRIM", "LTRIM", "RTRIM", "REPLACE",
  "INSTR", "PRINTF", "ROUND", "ABS", "RANDOM", "RANDOMBLOB", "ZEROBLOB",
  "HEX", "UNHEX", "DATE", "TIME", "DATETIME", "JULIANDAY", "STRFTIME",
  "ROW_NUMBER", "RANK", "DENSE_RANK", "LAG", "LEAD", "OVER", "PARTITION",
]);

const CLAUSE_BREAKS = new Set([
  "SELECT", "FROM", "WHERE", "JOIN", "INNER", "LEFT", "RIGHT", "FULL",
  "CROSS", "GROUP", "ORDER", "HAVING", "LIMIT", "OFFSET", "UNION",
  "INTERSECT", "EXCEPT", "VALUES", "SET", "ON",
]);

interface Token {
  type: "word" | "string" | "number" | "punct" | "comment";
  value: string;
}

function tokenize(sql: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    const two = sql.slice(i, i + 2);
    if (two === "--") {
      let j = i;
      while (j < n && sql[j] !== "\n") j++;
      tokens.push({ type: "comment", value: sql.slice(i, j) });
      i = j;
      continue;
    }
    if (two === "/*") {
      let j = i + 2;
      while (j < n && sql.slice(j, j + 2) !== "*/") j++;
      j = Math.min(n, j + 2);
      tokens.push({ type: "comment", value: sql.slice(i, j) });
      i = j;
      continue;
    }
    if (c === "'") {
      let j = i + 1;
      while (j < n) {
        if (sql[j] === "'" && sql[j + 1] === "'") {
          j += 2;
          continue;
        }
        if (sql[j] === "'") {
          j++;
          break;
        }
        j++;
      }
      tokens.push({ type: "string", value: sql.slice(i, j) });
      i = j;
      continue;
    }
    if (c === '"' || c === "`") {
      const q = c;
      let j = i + 1;
      while (j < n && sql[j] !== q) {
        if (sql[j] === q && sql[j + 1] === q) {
          j += 2;
          continue;
        }
        j++;
      }
      j = Math.min(n, j + 1);
      tokens.push({ type: "string", value: sql.slice(i, j) });
      i = j;
      continue;
    }
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(sql[i + 1] || ""))) {
      let j = i;
      while (j < n && /[0-9.eE+-]/.test(sql[j])) j++;
      tokens.push({ type: "number", value: sql.slice(i, j) });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_]/.test(sql[j])) j++;
      tokens.push({ type: "word", value: sql.slice(i, j) });
      i = j;
      continue;
    }
    tokens.push({ type: "punct", value: c });
    i++;
  }
  return tokens;
}

export function formatSql(sql: string): string {
  const tokens = tokenize(sql);
  const lines: string[] = [];
  let indent = 0;
  let afterSelect = false;
  let afterValues = false;
  let parenDepth = 0;
  let currentLine = "";

  const pushLine = () => {
    lines.push("  ".repeat(indent) + currentLine.trim());
    currentLine = "";
  };

  const needSpaceBefore = (tok: Token): boolean => {
    if (!currentLine) return false;
    const last = currentLine[currentLine.length - 1];
    if (last === "(") return false;
    if (tok.type === "punct" && (tok.value === "," || tok.value === ")" || tok.value === ";" || tok.value === ".")) return false;
    if (last === "." || last === "(") return false;
    return true;
  };

  const append = (text: string, spaceBefore = true) => {
    if (spaceBefore && currentLine && needSpaceBefore({ type: "punct", value: "" })) {
      currentLine += " ";
    }
    currentLine += text;
  };

  const appendWord = (text: string) => {
    if (currentLine && needSpaceBefore({ type: "word", value: text })) {
      currentLine += " ";
    }
    currentLine += text;
  };

  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k];
    const upper = t.type === "word" ? t.value.toUpperCase() : "";
    const isKeyword = t.type === "word" && KEYWORDS.has(upper);

    if (t.type === "comment") {
      if (currentLine) pushLine();
      lines.push("  ".repeat(indent) + t.value);
      continue;
    }

    if (t.type === "string" || t.type === "number") {
      appendWord(t.value);
      continue;
    }

    if (t.type === "punct") {
      if (t.value === "(") {
        parenDepth++;
        // No space before "(" when it follows a word (function call / type
        // args / CREATE TABLE args).
        const noSpaceBefore = currentLine && /[A-Za-z0-9_)]$/.test(currentLine);
        if (afterValues && parenDepth === 1) {
          append("(");
          pushLine();
          indent++;
        } else {
          append("(", !noSpaceBefore);
        }
        continue;
      }
      if (t.value === ")") {
        parenDepth = Math.max(0, parenDepth - 1);
        if (afterValues && parenDepth === 0) {
          if (currentLine) pushLine();
          indent = Math.max(0, indent - 1);
          currentLine = ")";
          afterValues = false;
        } else {
          append(")", false);
        }
        continue;
      }
      if (t.value === ",") {
        append(",", false);
        if (afterSelect && parenDepth === 0) {
          pushLine();
        } else if (afterValues || (parenDepth > 0 && afterSelect === false && indent > 0)) {
          pushLine();
        }
        // Otherwise, leave a single trailing space via the next append's
        // spaceBefore logic — don't add one here (appendWord handles it).
        continue;
      }
      if (t.value === ";") {
        append(";", false);
        pushLine();
        indent = 0;
        afterSelect = false;
        afterValues = false;
        continue;
      }
      if (t.value === ".") {
        append(".", false);
        continue;
      }
      append(t.value);
      continue;
    }

    // word — handle clause breaks
    if (isKeyword && CLAUSE_BREAKS.has(upper) && parenDepth === 0) {
      if (upper === "SELECT") {
        if (currentLine) pushLine();
        indent = 0;
        currentLine = "SELECT";
        afterSelect = true;
        afterValues = false;
        continue;
      }
      if (upper === "VALUES") {
        if (currentLine) pushLine();
        currentLine = "VALUES";
        afterValues = true;
        afterSelect = false;
        continue;
      }
      if (upper === "FROM") {
        if (currentLine) pushLine();
        afterSelect = false;
        currentLine = "FROM";
        continue;
      }
      if (
        upper === "JOIN" || upper === "INNER" || upper === "LEFT" ||
        upper === "RIGHT" || upper === "FULL" || upper === "CROSS"
      ) {
        // Keep "LEFT JOIN" together: if the previous token was a JOIN-type
        // qualifier (LEFT/RIGHT/INNER/etc.) on its own line, append to it.
        if (
          (upper === "JOIN" || upper === "OUTER") &&
          /^(INNER|LEFT|RIGHT|FULL|CROSS)$/.test(currentLine.trim())
        ) {
          currentLine += " " + upper;
          continue;
        }
        if (currentLine) pushLine();
        currentLine = upper;
        continue;
      }
      if (upper === "ON") {
        appendWord("ON");
        continue;
      }
      if (upper === "WHERE" || upper === "GROUP" || upper === "ORDER" || upper === "HAVING" || upper === "LIMIT" || upper === "OFFSET" || upper === "SET") {
        if (currentLine) pushLine();
        currentLine = upper;
        continue;
      }
      if (upper === "UNION" || upper === "INTERSECT" || upper === "EXCEPT") {
        if (currentLine) pushLine();
        currentLine = upper;
        pushLine();
        continue;
      }
    }

    appendWord(isKeyword ? upper : t.value);
  }

  if (currentLine.trim()) pushLine();
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}
