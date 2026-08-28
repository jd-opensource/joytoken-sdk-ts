import type { AgentTool } from "../types.js";
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
export declare const DefaultSQLMaxRows = 200;
/**
 * sqlQuery returns a local tool that runs SQL against a host-provided database
 * adapter. The model supplies only SQL text; it never sees connection details.
 *
 * Register it under PermissionAuto when readOnly is true. When writes are
 * allowed, register it under PermissionAsk so the host approves each call.
 */
export declare function sqlQuery(config: SQLConfig): AgentTool;
/**
 * isReadOnlyStatement reports whether a statement only reads data. It inspects
 * the leading keyword after stripping leading line comments and whitespace.
 */
export declare function isReadOnlyStatement(statement: string): boolean;
//# sourceMappingURL=sql.d.ts.map