import type { Tool, ToolExecuteFunc, ToolExecutionContext } from "./tools.js";

/**
 * ShellPermissionRequest describes a pending shell invocation that the root
 * client presents to the host application for approval before it runs. The SDK
 * never renders UI; the host decides. command is the model-supplied command
 * line and workingDir is the resolved directory it would run in, so the host
 * can show the user exactly what would execute and where.
 */
export interface ShellPermissionRequest {
  toolName: string;
  input: unknown;
  command: string;
  workingDir: string;
  step: number;
}

/**
 * ShellPermissionFunc lets the host application approve or reject a shell call.
 * Returning false (or throwing) blocks the command. The shell tool is always
 * declared to the model; this callback is what makes it runnable. With no
 * callback configured, the declaration is still sent but every invocation is
 * refused at execution time, so the model sees the capability yet nothing runs
 * without host approval. It mirrors the Go WithShellPermission callback.
 */
export type ShellPermissionFunc = (request: ShellPermissionRequest) => Promise<boolean> | boolean;

/**
 * gateShell wraps a shell tool's execute with a host approval gate. It fails
 * safe: with no permission callback configured, or when the callback rejects or
 * throws, the command never runs and the model receives an error it can react
 * to. Because a shell command can do anything the host process can, the gate is
 * the safety boundary — the tool is always declared, but only runs behind it.
 * workingDir is captured so the host sees the exact directory a command targets.
 */
export function gateShell(
  tool: Tool,
  workingDir: string,
  permission: ShellPermissionFunc | undefined,
): Tool {
  const inner: ToolExecuteFunc | undefined = tool.execute;
  if (!inner) {
    return tool;
  }
  const guarded: ToolExecuteFunc = async (input: unknown, execution: ToolExecutionContext) => {
    if (!permission) {
      throw new Error(
        `tool ${JSON.stringify(tool.name)} rejected: no shell permission handler configured (set shellPermission to enable)`,
      );
    }
    const command = commandArg(input);
    let allow: boolean;
    try {
      allow = await permission({
        toolName: tool.name,
        input,
        command,
        workingDir,
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
      throw new Error(`tool ${JSON.stringify(tool.name)} rejected by shell permission handler`);
    }
    return inner(input, execution);
  };
  return { ...tool, execute: guarded };
}

/** commandArg extracts the model-supplied command string for the permission prompt, tolerating malformed input. */
function commandArg(input: unknown): string {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return "";
  const raw = (input as Record<string, unknown>).command;
  return typeof raw === "string" ? raw : "";
}