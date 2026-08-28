import { type Tool } from "./tools.js";
/**
 * ShellSandbox confines the shell tool: workingDir is the directory the command
 * runs in (empty/undefined means the process's current directory), timeoutMs
 * bounds a single invocation (zero/undefined means DefaultShellTimeoutMs), and
 * maxOutputBytes caps returned output (zero/undefined means
 * DefaultShellOutputBytes).
 *
 * Unlike FileSandbox, this type does not attempt to jail the command itself: a
 * shell command is inherently powerful, so the safety boundary is the host's
 * permission gate (see gateShell / the root client's shellPermission), not
 * lexical path containment. The sandbox only scopes where the command starts
 * and how much it can run and emit.
 *
 * This lives in client-sdk-ts (the bottom of the dependency graph) so the root
 * client can inject the shell tool by default while agent-sdk-ts re-exports the
 * same implementation through its toolkit without an import cycle.
 */
export interface ShellSandbox {
    workingDir?: string;
    timeoutMs?: number;
    maxOutputBytes?: number;
}
/** DefaultShellTimeoutMs bounds how long a single shell command may run before it is killed. */
export declare const DefaultShellTimeoutMs = 30000;
/** DefaultShellOutputBytes caps how many bytes of combined stdout/stderr are returned to the model. */
export declare const DefaultShellOutputBytes: number;
/**
 * absWorkingDir resolves the sandbox working directory to an absolute path. An
 * empty/undefined dir falls back to the current working directory, so commands
 * run in the project the host is actually running in. Exposed so the client can
 * show the host the exact directory a command would run in during permission
 * prompts.
 */
export declare function absWorkingDir(sandbox: ShellSandbox): string;
/**
 * shell returns a local tool that runs a shell command and returns its combined
 * stdout/stderr. Because a command can read, write, delete, or exfiltrate
 * anything the host process can touch, this tool has real, unbounded side
 * effects: the root client always declares it to the model but gates every
 * invocation behind a host permission callback (see gateShell), failing safe
 * when no callback is configured.
 *
 * The command runs through the platform shell inside the configured working
 * directory, is killed after the sandbox timeout, and its combined
 * stdout/stderr is truncated to the sandbox output cap before being handed back
 * to the model.
 */
export declare function shell(sandbox: ShellSandbox): Tool;
//# sourceMappingURL=shell-tools.d.ts.map