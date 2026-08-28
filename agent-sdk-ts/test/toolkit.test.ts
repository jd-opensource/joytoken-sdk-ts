import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentOptions, AgentTool, ToolExecutionContext } from "../src/index.js";
import {
  MaxArgBytes,
  PermissionMode,
  Toolkit,
  calculator,
  dateTime,
  defaultToolkit,
  evalExpression,
  stringArg,
  timeout,
  withDefaults,
} from "../src/toolkit/index.js";

const ctx: ToolExecutionContext = {
  step: 1,
  toolCall: { id: "call_1", type: "function", function: { name: "t", arguments: "{}" } },
  messages: [],
};

async function call(tool: AgentTool, input: unknown): Promise<unknown> {
  return tool.execute(input, ctx);
}

test("evalExpression handles arithmetic, precedence and parentheses", () => {
  assert.equal(evalExpression("1 + 2 * 3"), 7);
  assert.equal(evalExpression("(2 + 3) * 4.5"), 22.5);
  assert.equal(evalExpression("-5 + 3"), -2);
  assert.equal(evalExpression("10 % 3"), 1);
});

test("evalExpression rejects division and modulo by zero", () => {
  assert.throws(() => evalExpression("1 / 0"), /division by zero/);
  assert.throws(() => evalExpression("1 % 0"), /modulo by zero/);
});

test("evalExpression rejects empty and malformed input", () => {
  assert.throws(() => evalExpression("   "), /empty expression/);
  assert.throws(() => evalExpression("1 +"), /expected number/);
  assert.throws(() => evalExpression("1 2"), /unexpected character/);
});

test("calculator evaluates and coerces a numeric expression argument", async () => {
  const tool = calculator();
  assert.deepEqual(await call(tool, { expression: "2 + 2" }), { result: 4 });
  // Models frequently emit a number where a string is expected.
  assert.deepEqual(await call(tool, { expression: 42 }), { result: 42 });
});

test("calculator surfaces eval errors as thrown errors", async () => {
  await assert.rejects(() => call(calculator(), { expression: "1 / 0" }), /calculator: division by zero/);
});

test("stringArg rejects structured values and enforces the size cap", () => {
  assert.throws(() => stringArg({ expression: [1, 2] }, "expression"), /must be a string/);
  assert.throws(() => stringArg({ expression: { a: 1 } }, "expression"), /must be a string/);
  assert.throws(() => stringArg({ expression: null }, "expression"), /must be a string/);
  assert.throws(() => stringArg({}, "expression"), /missing required argument/);
  assert.throws(() => stringArg("not-object", "expression"), /expected object input/);
  const big = "1".repeat(MaxArgBytes + 1);
  assert.throws(() => stringArg({ expression: big }, "expression"), /exceeds limit/);
});

test("datetime returns a timestamp in the requested timezone", async () => {
  const result = (await call(dateTime(), { timezone: "UTC" })) as {
    datetime: string;
    timezone: string;
    unix: number;
  };
  assert.equal(result.timezone, "UTC");
  assert.equal(typeof result.datetime, "string");
  assert.equal(typeof result.unix, "number");
});

test("datetime rejects an invalid timezone", async () => {
  await assert.rejects(() => call(dateTime(), { timezone: "Not/AZone" }), /invalid timezone/);
});

test("defaultToolkit exposes exactly calculator and datetime", () => {
  const names = defaultToolkit().tools().map((tool) => tool.name);
  assert.deepEqual(names, ["calculator", "datetime"]);
});

test("withDefaults injects the default tool set only when tools is undefined", () => {
  const base: AgentOptions = { model: { async complete() { return { message: { role: "assistant", content: "" } }; } } };

  const injected = withDefaults(base);
  assert.deepEqual(injected.tools?.map((tool) => tool.name), ["calculator", "datetime"]);

  // An explicitly empty array preserves the host's intent to run with no tools.
  const emptyKept = withDefaults({ ...base, tools: [] });
  assert.deepEqual(emptyKept.tools, []);

  // Host-provided tools are passed through untouched (the passthrough route).
  const custom: AgentTool = { name: "custom", execute: () => "ok" };
  const preserved = withDefaults({ ...base, tools: [custom] });
  assert.deepEqual(preserved.tools?.map((tool) => tool.name), ["custom"]);
});

test("withDefaults does not mutate the caller's options", () => {
  const base: AgentOptions = { model: { async complete() { return { message: { role: "assistant", content: "" } }; } } };
  withDefaults(base);
  assert.equal(base.tools, undefined);
});

test("permission Deny blocks the tool", async () => {
  const toolkit = new Toolkit({ permission: { mode: PermissionMode.Deny } }).register(calculator());
  const tool = toolkit.tools()[0]!;
  await assert.rejects(() => call(tool, { expression: "1 + 1" }), /denied by permission policy/);
});

test("permission Ask without a handler fails safe", async () => {
  const toolkit = new Toolkit({ permission: { mode: PermissionMode.Ask } }).register(calculator());
  const tool = toolkit.tools()[0]!;
  await assert.rejects(() => call(tool, { expression: "1 + 1" }), /no permission handler is configured/);
});

test("permission Ask consults the handler and honors its decision", async () => {
  const requests: string[] = [];
  const toolkit = new Toolkit({
    permission: {
      mode: PermissionMode.Ask,
      ask: (request) => {
        requests.push(request.toolName);
        return request.toolName === "calculator";
      },
    },
  }).register(calculator());
  const tool = toolkit.tools()[0]!;
  assert.deepEqual(await call(tool, { expression: "3 * 3" }), { result: 9 });
  assert.deepEqual(requests, ["calculator"]);
});

test("permission Ask rejects when the handler returns false", async () => {
  const toolkit = new Toolkit({
    permission: { mode: PermissionMode.Ask, ask: () => false },
  }).register(calculator());
  const tool = toolkit.tools()[0]!;
  await assert.rejects(() => call(tool, { expression: "1 + 1" }), /rejected by permission handler/);
});

test("timeout middleware surfaces a timeout error", async () => {
  const slow: AgentTool = {
    name: "slow",
    execute: () => new Promise((resolve) => setTimeout(() => resolve("late"), 50)),
  };
  const toolkit = new Toolkit({ middleware: [timeout(5)] }).register(slow);
  const tool = toolkit.tools()[0]!;
  await assert.rejects(() => call(tool, {}), /timed out after 5ms/);
});