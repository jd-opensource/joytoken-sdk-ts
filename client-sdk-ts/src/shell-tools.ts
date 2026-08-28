import { exec } from "node:child_process";
import { resolve } from "node:path";
import { defineTool, MaxArgBytes, type Tool } from "./tools.js";

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
export const DefaultShellTimeoutMs = 30_000;

/** DefaultShellOutputBytes caps how many bytes of combined stdout/stderr are returned to the model. */
export const DefaultShellOutputBytes = 64 << 10; // 64 KiB

/**
 * absWorkingDir resolves the sandbox working directory to an absolute path. An
 * empty/undefined dir falls back to the current working directory, so commands
 * run in the project the host is actually running in. Exposed so the client can
 * show the host the exact directory a command would run in during permission
 * prompts.
 */
export function absWorkingDir(sandbox: ShellSandbox): string {
  const dir = sandbox.workingDir && sandbox.workingDir !== "" ? sandbox.workingDir : undefined;
  return resolve(dir ?? globalThis.process?.cwd?.() ?? ".");
}

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
export function shell(sandbox: ShellSandbox): Tool {
  return defineTool({
    name: "shell",
    description:
      "Run a shell command and return its combined stdout/stderr. Use it to build, test, inspect, or manipulate the workspace. The command runs in the configured working directory and is subject to a time limit.",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: 'The shell command line to execute, e.g. "ls -la" or "npm test".',
        },
      },
      required: ["command"],
    },
    execute: async (input) => {
      const command = stringArg(input, "command");
      const cwd = sandbox.workingDir && sandbox.workingDir !== "" ? sandbox.workingDir : undefined;
      const timeout = sandbox.timeoutMs && sandbox.timeoutMs > 0 ? sandbox.timeoutMs : DefaultShellTimeoutMs;
      const max = sandbox.maxOutputBytes && sandbox.maxOutputBytes > 0 ? sandbox.maxOutputBytes : DefaultShellOutputBytes;

      return await new Promise((resolvePromise, reject) => {
        exec(
          command,
          { cwd, timeout, maxBuffer: max, windowsHide: true },
          (error, stdout, stderr) => {
            const combined = `${stdout ?? ""}${stderr ?? ""}`;
            const { output, truncated } = truncate(combined, max);

            if (error) {
              const err = error as NodeJS.ErrnoException & { code?: string | number; killed?: boolean; signal?: string };
              if (err.killed || err.signal === "SIGTERM") {
                resolvePromise({ command, output, truncated, timed_out: true, exit_code: -1 });
                return;
              }
              if (typeof err.code === "number") {
                resolvePromise({ command, output, truncated, exit_code: err.code });
                return;
              }
              if (err.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
                resolvePromise({ command, output, truncated: true, output_limit_exceeded: true, exit_code: -1 });
                return;
              }
              reject(new Error(`shell: ${err.message}`));
              return;
            }
            resolvePromise({ command, output, truncated, exit_code: 0 });
          },
        );
      });
    },
  });
}

/** truncate returns at most max bytes of text and reports whether truncation occurred. */
function truncate(text: string, max: number): { output: string; truncated: boolean } {
  if (max > 0 && Buffer.byteLength(text, "utf8") > max) {
    return { output: Buffer.from(text, "utf8").subarray(0, max).toString("utf8"), truncated: true };
  }
  return { output: text, truncated: false };
}

function stringArg(input: unknown, key: string): string {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error(`expected object input, got ${describe(input)}`);
  }
  const object = input as Record<string, unknown>;
  if (!(key in object)) {
    throw new Error(`missing required argument ${JSON.stringify(key)}`);
  }
  const raw = object[key];
  const value = typeof raw === "string" ? raw : String(raw);
  if (value.length > MaxArgBytes) {
    throw new Error(`argument ${JSON.stringify(key)} is ${value.length} bytes, exceeds limit of ${MaxArgBytes}`);
  }
  return value;
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}
