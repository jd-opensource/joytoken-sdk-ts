import { type Tool } from "./tools.js";
/**
 * FileSandbox confines the file tools to a single root directory. Every path
 * the model supplies is resolved relative to root and validated to stay inside
 * it, so the model can never read or write outside the sandbox. An empty root
 * falls back to the current working directory (see absRoot), matching the
 * Codex/Claude "project workspace" model. maxBytes caps the size of a single
 * read or write; zero/undefined means DefaultFileMaxBytes.
 *
 * This lives in client-sdk-ts (the bottom of the dependency graph) so the root
 * client can inject the file tools by default while agent-sdk-ts re-exports the
 * same implementations through its toolkit without an import cycle.
 */
export interface FileSandbox {
    root?: string;
    maxBytes?: number;
}
/** DefaultFileMaxBytes is the per-operation size cap used when maxBytes is unset. */
export declare const DefaultFileMaxBytes: number;
/** DefaultSearchLimit bounds how many entries list_dir and file_search return in one call. */
export declare const DefaultSearchLimit = 200;
/**
 * fileRead returns a local, read-only tool that reads a UTF-8 text file from
 * within the sandbox. It is side-effect free and safe to run without approval.
 */
export declare function fileRead(sandbox: FileSandbox): Tool;
/**
 * fileWrite returns a local tool that writes a UTF-8 text file inside the
 * sandbox, creating parent directories as needed. Because it has real side
 * effects, the root client wraps its execute with a fail-closed host approval
 * gate. It may be declared without a callback, but cannot execute without one.
 */
export declare function fileWrite(sandbox: FileSandbox): Tool;
/**
 * listDir returns a local, read-only tool that lists the entries of a directory
 * inside the sandbox. Use "." for the sandbox root. At most DefaultSearchLimit
 * entries are returned, with a truncated flag set when the directory has more,
 * so a huge directory cannot flood the model's context.
 */
export declare function listDir(sandbox: FileSandbox): Tool;
/**
 * fileSearch returns a local, read-only tool that recursively searches the
 * sandbox for files whose base name matches a glob pattern. Results are sorted
 * and capped at DefaultSearchLimit.
 */
export declare function fileSearch(sandbox: FileSandbox): Tool;
/**
 * absRoot resolves the sandbox root to an absolute path. An empty root falls
 * back to the current working directory, so the exposed surface is the project
 * the host is actually running in. Exposed so the client can show the host the
 * exact directory a write would land in during permission prompts.
 */
export declare function absRoot(sandbox: FileSandbox): string;
//# sourceMappingURL=file-tools.d.ts.map