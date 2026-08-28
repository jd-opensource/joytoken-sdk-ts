import { type FileSandbox as ClientFileSandbox } from "@joytoken/client-sdk-ts";
import type { AgentTool } from "../types.js";
/**
 * The file tools live in @joytoken/client-sdk-ts (the bottom of the dependency
 * graph) so the root client can inject them by default. This module is a thin
 * re-export so agent-sdk-ts keeps its historical toolkit surface without an
 * import cycle. Every client file tool carries an `execute`, so a client `Tool`
 * satisfies the agent `AgentTool` contract (whose only difference is that
 * `execute` is required). requireExecutable verifies that invariant at runtime
 * instead of relying on a bare `as AgentTool` cast, so a future client change
 * that dropped `execute` fails loudly here rather than silently producing a
 * non-executable tool.
 */
export type FileSandbox = ClientFileSandbox;
/** DefaultFileMaxBytes is the per-operation size cap used when maxBytes is unset. */
export declare const DefaultFileMaxBytes: number;
/** DefaultSearchLimit bounds how many entries list_dir and file_search return. */
export declare const DefaultSearchLimit = 200;
/** fileRead returns a local, read-only tool that reads a UTF-8 text file. */
export declare function fileRead(sandbox: FileSandbox): AgentTool;
/** fileWrite returns a local tool that writes a UTF-8 text file. */
export declare function fileWrite(sandbox: FileSandbox): AgentTool;
/** listDir returns a local, read-only tool that lists a directory's entries. */
export declare function listDir(sandbox: FileSandbox): AgentTool;
/** fileSearch returns a local, read-only tool that globs the sandbox for files. */
export declare function fileSearch(sandbox: FileSandbox): AgentTool;
//# sourceMappingURL=file.d.ts.map