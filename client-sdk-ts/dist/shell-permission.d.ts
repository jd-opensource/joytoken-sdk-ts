import type { Tool } from "./tools.js";
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
export declare function gateShell(tool: Tool, workingDir: string, permission: ShellPermissionFunc | undefined): Tool;
//# sourceMappingURL=shell-permission.d.ts.map