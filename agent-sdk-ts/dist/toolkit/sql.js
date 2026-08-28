import { defineTool } from "../tools.js";
import { stringArg } from "./tools.js";
/** DefaultSQLMaxRows bounds the rows returned by a single query. */
export const DefaultSQLMaxRows = 200;
/**
 * sqlQuery returns a local tool that runs SQL against a host-provided database
 * adapter. The model supplies only SQL text; it never sees connection details.
 *
 * Register it under PermissionAuto when readOnly is true. When writes are
 * allowed, register it under PermissionAsk so the host approves each call.
 */
export function sqlQuery(config) {
    const maxRows = config.maxRows && config.maxRows > 0 ? config.maxRows : DefaultSQLMaxRows;
    const readOnlyMode = config.readOnly ?? false;
    return defineTool({
        name: "sql_query",
        description: "Execute a SQL statement against the configured database and return the rows. Provide a single statement.",
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
async function runQuery(db, statement, maxRows) {
    let result;
    try {
        result = await db.query(statement);
    }
    catch (error) {
        throw new Error(`sql_query: ${error instanceof Error ? error.message : String(error)}`);
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
export function isReadOnlyStatement(statement) {
    let s = statement.trim().toLowerCase();
    while (s.startsWith("--")) {
        const idx = s.indexOf("\n");
        if (idx < 0)
            return false;
        s = s.slice(idx + 1).trim();
    }
    return (s.startsWith("select") ||
        s.startsWith("with") ||
        s.startsWith("explain") ||
        s.startsWith("show") ||
        s.startsWith("pragma"));
}
//# sourceMappingURL=sql.js.map