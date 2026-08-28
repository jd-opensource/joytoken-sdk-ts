import assert from "node:assert/strict";
import { test } from "node:test";
import {
  shell,
  gateShell,
  type ShellSandbox,
  type ShellPermissionFunc,
  type ToolExecutionContext,
} from "../src/index.js";

// ctx builds a minimal ToolExecutionContext so a tool's execute can be driven
// directly, without standing up the full client loop.
function ctx(step = 0): ToolExecutionContext {
  return {
    step,
    toolCall: { id: "call_0", type: "function", function: { name: "shell", arguments: "" } },
    messages: [],
  };
}

// With no permission callback, the shell tool is still constructable and
// declarable, but the gate must refuse every invocation. This mirrors the Go
// RefusedWithoutCallback test: the model sees the capability, nothing runs.
test("gateShell refuses to run when no permission callback is configured", async () => {
  const sandbox: ShellSandbox = {};
  const gated = gateShell(shell(sandbox), ".", undefined);

  await assert.rejects(
    () => gated.execute!({ command: "echo should-not-run" }, ctx()),
    /no shell permission handler configured/,
  );
});

// A denying callback blocks the command entirely.
test("gateShell blocks the command when the callback denies", async () => {
  const sandbox: ShellSandbox = {};
  const deny: ShellPermissionFunc = () => false;
  const gated = gateShell(shell(sandbox), ".", deny);

  await assert.rejects(
    () => gated.execute!({ command: "echo nope" }, ctx()),
    /rejected by shell permission handler/,
  );
});

// A throwing callback surfaces as a permission-check failure and blocks the run.
test("gateShell surfaces a throwing permission callback", async () => {
  const sandbox: ShellSandbox = {};
  const boom: ShellPermissionFunc = () => {
    throw new Error("handler exploded");
  };
  const gated = gateShell(shell(sandbox), ".", boom);

  await assert.rejects(
    () => gated.execute!({ command: "echo nope" }, ctx()),
    /permission check failed: handler exploded/,
  );
});

// An approving callback lets the command run and returns its combined output.
test("gateShell runs an approved command and returns its output", async () => {
  const sandbox: ShellSandbox = {};
  const allow: ShellPermissionFunc = () => true;
  const gated = gateShell(shell(sandbox), ".", allow);

  const result = (await gated.execute!({ command: "echo joytoken" }, ctx())) as {
    output: string;
    exit_code: number;
  };
  assert.equal(result.exit_code, 0);
  assert.match(result.output, /joytoken/);
});

// A non-zero exit is reported through exit_code rather than thrown, so the
// model can read the failure and react.
test("shell reports a non-zero exit code without throwing", async () => {
  const sandbox: ShellSandbox = {};
  const allow: ShellPermissionFunc = () => true;
  const gated = gateShell(shell(sandbox), ".", allow);

  const result = (await gated.execute!({ command: "exit 3" }, ctx())) as { exit_code: number };
  assert.equal(result.exit_code, 3);
});

test("shell enforces its output cap while the process is running", async () => {
  const sandbox: ShellSandbox = { maxOutputBytes: 4 };
  const gated = gateShell(shell(sandbox), ".", () => true);
  const result = (await gated.execute!({ command: "printf 123456789" }, ctx())) as {
    output: string;
    truncated: boolean;
    output_limit_exceeded?: boolean;
  };
  assert.ok(Buffer.byteLength(result.output, "utf8") <= 4);
  assert.equal(result.truncated, true);
  assert.equal(result.output_limit_exceeded, true);
});
