import type { AgentTool } from "../types.js";
import { defineTool } from "../tools.js";
import { stringArg } from "./tools.js";

/**
 * SQLQueryResult is the shape a host database adapter returns for a read-only
 * statement. columns is the ordered column list; rows maps each column name to
 * its value.
 */
export interface SQLQueryResult {
  columns: string[];
  rows: Array<Record<string, unknown>>;
}

/**
 * SQLExecResult is the shape a host database adapter returns for a mutating
 * statement.
 */
export interface SQLExecResult {
  rowsAffected: number;
  lastInsertId?: number | string;
}

/**
 * SQLDatabase is the minimal database interface the host injects. Node has no
 * standard database/sql package, so the host wraps its own driver (mysql2, pg,
 * better-sqlite3, ...) behind this interface. Credentials never reach the
 * model: the host establishes the connection once and only the query/exec text
 * flows through the tool.
 */
export interface SQLDatabase {
  query(sql: string): Promise<SQLQueryResult> | SQLQueryResult;
  /** exec is only required when writes are allowed (readOnly=false). */
  exec?(sql: string): Promise<SQLExecResult> | SQLExecResult;
}

/**
 * SQLConfig configures the local sql_query tool.
 */
export interface SQLConfig {
  /** db is the host-provided database adapter. Required. */
  db: SQLDatabase;
  /**
   * readOnly, when true, rejects any statement that is not a read-only query
   * (SELECT / WITH / EXPLAIN / SHOW / PRAGMA). This is the recommended mode:
   * pair it with PermissionAuto. To allow writes, set readOnly=false, provide
   * db.exec, and wrap the tool with PermissionAsk so the host approves each
   * mutation.
   */
  readOnly?: boolean;
  /** maxRows caps the number of rows returned. Zero/undefined means DefaultSQLMaxRows. */
  maxRows?: number;
}

/** DefaultSQLMaxRows bounds the rows returned by a single query. */
export const DefaultSQLMaxRows = 200;

/**
 * sqlQuery returns a local tool that runs SQL against a host-provided database
 * adapter. The model supplies only SQL text; it never sees connection details.
 *
 * Register it under PermissionAuto when readOnly is true. When writes are
 * allowed, register it under PermissionAsk so the host approves each call.
 */
export function sqlQuery(config: SQLConfig): AgentTool {
  const maxRows = config.maxRows && config.maxRows > 0 ? config.maxRows : DefaultSQLMaxRows;
  const readOnlyMode = config.readOnly ?? false;

  return defineTool({
    name: "sql_query",
    description:
      "Execute a SQL statement against the configured database and return the rows. Provide a single statement.",
    parameters: {
      type: "object",
      properties: {
        sql: {
          type: "string",
          description: "A single SQL statement to execute.",
        },
      },
      required: ["sql"],
    },
    execute: async (input) => {
      const statement = stringArg(input, "sql").trim();
      if (!statement) {
        throw new Error("sql_query: empty statement");
      }
      if (!config.db) {
        throw new Error("sql_query: database handle is not configured");
      }
      const readOnly = isReadOnlyStatement(statement);
      if (readOnlyMode && !readOnly) {
        throw new Error("sql_query: only read-only statements are allowed");
      }

      if (readOnly) {
        return runQuery(config.db, statement, maxRows);
      }
      if (!config.db.exec) {
        throw new Error("sql_query: writes are not supported (no exec adapter configured)");
      }
      const result = await config.db.exec(statement);
      return {
        rows_affected: result.rowsAffected,
        last_insert_id: result.lastInsertId ?? null,
        read_only: false,
      };
    },
  });
}

/** runQuery executes a read-only statement and returns rows, capped at maxRows. */
async function runQuery(db: SQLDatabase, statement: string, maxRows: number): Promise<unknown> {
  let result: SQLQueryResult;
  try {
    result = await db.query(statement);
  } catch (error) {
    throw new Error(`sql_query: ${error instanceof Error ? error.message: String(error)}`);
  }
  const truncated = result.rows.length > maxRows;
  const rows = truncated ? result.rows.slice(0, maxRows) : result.rows;
  return {
    columns: result.columns,
    rows,
    row_count: rows.length,
    truncated,
  };
}

/**
 * isReadOnlyStatement reports whether a statement only reads data. It inspects
 * the leading keyword after stripping leading line comments and whitespace.
 */
export function isReadOnlyStatement(statement: string): boolean {
  let s = statement.trim().toLowerCase();
  while (s.startsWith("--")) {
    const idx = s.indexOf("\n");
    if (idx < 0) return false;
    s = s.slice(idx + 1).trim();
  }
  return (
    s.startsWith("select") ||
    s.startsWith("with") ||
    s.startsWith("explain") ||
    s.startsWith("show") ||
    s.startsWith("pragma")
  );
}