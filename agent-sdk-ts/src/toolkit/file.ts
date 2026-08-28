import {
  DefaultFileMaxBytes as ClientDefaultFileMaxBytes,
  DefaultSearchLimit as ClientDefaultSearchLimit,
  fileRead as clientFileRead,
  fileWrite as clientFileWrite,
  listDir as clientListDir,
  fileSearch as clientFileSearch,
  type FileSandbox as ClientFileSandbox,
  type Tool as ClientTool,
} from "@joytoken/client-sdk-ts";
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
export const DefaultFileMaxBytes = ClientDefaultFileMaxBytes;

/** DefaultSearchLimit bounds how many entries list_dir and file_search return. */
export const DefaultSearchLimit = ClientDefaultSearchLimit;

/**
 * requireExecutable narrows a client Tool to an AgentTool, throwing if the tool
 * has no `execute`. This turns the AgentTool contract's only extra requirement
 * into a checked runtime invariant.
 */
function requireExecutable(tool: ClientTool): AgentTool {
  if (typeof tool.execute !== "function") {
    throw new Error(`file tool ${JSON.stringify(tool.name)} is missing an execute function`);
  }
  return tool as AgentTool;
}

/** fileRead returns a local, read-only tool that reads a UTF-8 text file. */
export function fileRead(sandbox: FileSandbox): AgentTool {
  return requireExecutable(clientFileRead(sandbox));
}

/** fileWrite returns a local tool that writes a UTF-8 text file. */
export function fileWrite(sandbox: FileSandbox): AgentTool {
  return requireExecutable(clientFileWrite(sandbox));
}

/** listDir returns a local, read-only tool that lists a directory's entries. */
export function listDir(sandbox: FileSandbox): AgentTool {
  return requireExecutable(clientListDir(sandbox));
}

/** fileSearch returns a local, read-only tool that globs the sandbox for files. */
export function fileSearch(sandbox: FileSandbox): AgentTool {
  return requireExecutable(clientFileSearch(sandbox));
}