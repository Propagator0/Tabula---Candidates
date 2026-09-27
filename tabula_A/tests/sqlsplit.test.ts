import { describe, expect, test } from "bun:test";
import { bareWords, splitSql } from "../server/sqlsplit";

describe("splitSql", () => {
  test("splits ordinary scripts and ignores comments", () => {
    const out = splitSql("-- hi\nSELECT ';' AS x; /* gap */ INSERT INTO t VALUES (1);");
    expect(out.map(x => x.sql)).toHaveLength(2);
    expect(out[0].sql).toContain("SELECT");
    expect(out[1].sql).toContain("INSERT");
  });

  test("keeps trigger bodies together, including CASE END", () => {
    const src = `CREATE TRIGGER tr AFTER UPDATE ON a BEGIN
      UPDATE b SET x = CASE WHEN NEW.x > 0 THEN 1 ELSE 0 END;
      INSERT INTO log VALUES ('done; yes');
    END;
    SELECT 1;`;
    const out = splitSql(src);
    expect(out).toHaveLength(2);
    expect(out[0].sql).toContain("INSERT INTO log");
    expect(out[1].sql).toBe("SELECT 1");
  });
});

describe("bareWords", () => {
  test("does not inspect strings or quoted identifiers", () => {
    expect(bareWords(`CREATE TABLE x ("CHECK" TEXT DEFAULT 'COLLATE')`)).toEqual(["CREATE", "TABLE", "X", "TEXT", "DEFAULT"]);
  });
});
