import type { ToolExecutionContext } from "../types.js";
/**
 * ToolExecuteFunc is the wrapped form of a tool's execute method used inside
 * the middleware chain. It normalizes the tool's signature to a Promise so
 * middleware can uniformly await, race, and catch it.
 */
export type ToolExecuteFunc = (input: unknown, execution: ToolExecutionContext) => Promise<unknown>;
/**
 * Middleware wraps a tool's execute function to add cross-cutting behavior such
 * as timeouts or auditing. The tool name is provided so a single middleware can
 * vary its behavior per tool. Middleware registered first is the outermost
 * layer.
 */
export type Middleware = (name: string, next: ToolExecuteFunc) => ToolExecuteFunc;
/**
 * timeout returns middleware that bounds each tool call to the given number of
 * milliseconds. A non-positive duration disables the timeout.
 *
 * Unlike Go, JavaScript has no goroutine to cancel: the underlying tool keeps
 * running in the background after a timeout fires. The middleware only bounds
 * how long the agent waits for the result before surfacing a timeout error the
 * model can feed back on. A tool that supports cooperative cancellation should
 * read an AbortSignal from its own closure.
 */
export declare function timeout(ms: number): Middleware;
/**
 * audit returns middleware that reports each tool invocation and its outcome
 * through the provided callback. The callback must not block for long; it runs
 * inline after the tool executes (or throws).
 */
export declare function audit(log: (name: string, input: unknown, error?: unknown) => void): Middleware;
//# sourceMappingURL=middleware.d.ts.map