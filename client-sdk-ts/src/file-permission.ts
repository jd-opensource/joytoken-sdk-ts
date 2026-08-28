import type { Tool, ToolExecuteFunc, ToolExecutionContext } from "./tools.js";

/**
 * FilePermissionRequest describes a pending side-effecting file operation that
 * the root client presents to the host application for approval before it runs.
 * The SDK never renders UI; the host decides. root is the absolute sandbox root
 * the write would land in, so the host can show the exact target directory.
 */
export interface FilePermissionRequest {
  toolName: string;
  input: unknown;
  root: string;
  step: number;
}

/**
 * FilePermissionFunc lets the host application approve or reject a file write.
 * Returning false (or throwing) blocks execution. It mirrors the Go WithFile
 * Permission callback. The file_write tool is always declared to the model;
 * this callback is what makes it runnable. With no callback configured, the
 * declaration is still sent but every write is refused at execution time, so
 * the model sees the capability yet nothing is written without host approval.
 */
export type FilePermissionFunc = (request: FilePermissionRequest) => Promise<boolean> | boolean;

/**
 * gateFileWrite wraps a file_write tool's execute with a host approval gate. It
 * fails safe: with no permission callback configured, or when the callback
 * rejects or throws, the write never happens and the model receives an error it
 * can react to. root is captured so the host sees the exact directory the write
 * targets.
 */
export function gateFileWrite(tool: Tool, root: string, permission: FilePermissionFunc | undefined): Tool {
  const inner: ToolExecuteFunc | undefined = tool.execute;
  if (!inner) {
    return tool;
  }
  const guarded: ToolExecuteFunc = async (input: unknown, execution: ToolExecutionContext) => {
    if (!permission) {
      throw new Error(
        `tool ${JSON.stringify(tool.name)} rejected: no file permission handler configured (set filePermission to enable)`,
      );
    }
    let allow: boolean;
    try {
      allow = await permission({
        toolName: tool.name,
        input,
        root,
        step: execution.step,
      });
    } catch (error) {
      throw new Error(
        `tool ${JSON.stringify(tool.name)} permission check failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    if (!allow) {
      throw new Error(`tool ${JSON.stringify(tool.name)} rejected by file permission handler`);
    }
    return inner(input, execution);
  };
  return { ...tool, execute: guarded };
}