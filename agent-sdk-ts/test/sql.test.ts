import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentTool, ToolExecutionContext } from "../src/index.js";
import type { SQLDatabase, SQLExecResult, SQLQueryResult } from "../src/toolkit/index.js";
import { isReadOnlyStatement, sqlQuery } from "../src/toolkit/index.js";

const ctx: ToolExecutionContext = {
  step: 1,
  toolCall: { id: "call_1", type: "function", function: { name: "t", arguments: "{}" } },
  messages: [],
};

function call(tool: AgentTool, input: unknown): Promise<unknown> {
  return Promise.resolve(tool.execute(input, ctx));
}

/** fakeDB is a minimal in-memory adapter that returns two fixed rows. */
function fakeDB(overrides: Partial<SQLDatabase> = {}): SQLDatabase {
  return {
    query(): SQLQueryResult {
      return {
        columns: ["id", "name"],
        rows: [
          { id: 1, name: "alice" },
          { id: 2, name: "bob" },
        ],
      };
    },
    exec(): SQLExecResult {
      return { rowsAffected: 1, lastInsertId: 42 };
    },
    ...overrides,
  };
}

test("isReadOnlyStatement classifies statements correctly", () => {
  for (const s of [
    "SELECT 1",
    "  select * from t",
    "WITH x AS (SELECT 1) SELECT * FROM x",
    "EXPLAIN SELECT 1",
    "SHOW TABLES",
    "PRAGMA table_info(t)",
    "-- comment\nSELECT 1",
  ]) {
    assert.equal(isReadOnlyStatement(s), true, `expected read-only: ${s}`);
  }
  for (const s of [
    "INSERT INTO t VALUES (1)",
    "UPDATE t SET x=1",
    "DELETE FROM t",
    "DROP TABLE t",
    "CREATE TABLE t (id int)",
    "-- only comment",
  ]) {
    assert.equal(isReadOnlyStatement(s), false, `expected NOT read-only: ${s}`);
  }
});

test("sqlQuery read-only mode rejects a write", async () => {
  const tool = sqlQuery({ db: fakeDB(), readOnly: true });
  await assert.rejects(
    () => call(tool, { sql: "DELETE FROM t" }),
    /only read-only statements/,
  );
});

test("sqlQuery returns rows capped by maxRows", async () => {
  const tool = sqlQuery({ db: fakeDB(), readOnly: true, maxRows: 1 });
  const out = (await call(tool, { sql: "SELECT id, name FROM t" })) as {
    row_count: number;
    truncated: boolean;
    rows: Array<{ name: string }>;
  };
  assert.equal(out.row_count, 1);
  assert.equal(out.truncated, true);
  assert.equal(out.rows[0].name, "alice");
});

test("sqlQuery rejects an empty statement", async () => {
  const tool = sqlQuery({ db: fakeDB(), readOnly: true });
  await assert.rejects(() => call(tool, { sql: "   " }), /empty statement/);
});

test("sqlQuery runs a write through exec when writes are allowed", async () => {
  const tool = sqlQuery({ db: fakeDB(), readOnly: false });
  const out = (await call(tool, { sql: "INSERT INTO t VALUES (1)" })) as {
    rows_affected: number;
    last_insert_id: number;
    read_only: boolean;
  };
  assert.equal(out.rows_affected, 1);
  assert.equal(out.last_insert_id, 42);
  assert.equal(out.read_only, false);
});

test("sqlQuery rejects a write when no exec adapter is configured", async () => {
  const tool = sqlQuery({ db: fakeDB({ exec: undefined }), readOnly: false });
  await assert.rejects(
    () => call(tool, { sql: "INSERT INTO t VALUES (1)" }),
    /writes are not supported/,
  );
});