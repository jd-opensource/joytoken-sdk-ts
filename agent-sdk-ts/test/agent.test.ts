import assert from "node:assert/strict";
import { test } from "node:test";
import { Agent, defineTool, maxToolCalls, stepCountIs, type ModelProvider } from "../src/index.js";

test("runs an agent loop with a tool call", async () => {
  const provider: ModelProvider = {
    async complete({ messages }) {
      const hasToolResult = messages.some((message) => message.role === "tool");
      if (!hasToolResult) {
        return {
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: { name: "lookup", arguments: "{\"id\":\"42\"}" },
              },
            ],
          },
          usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7, cost: 0.01 },
        };
      }

      return {
        message: { role: "assistant", content: "record:42" },
        usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10, cost: 0.02 },
      };
    },
  };

  const agent = new Agent({
    model: provider,
    stopWhen: [stepCountIs(4), maxToolCalls(4)],
    tools: [
      defineTool<{ id: string }>({
        name: "lookup",
        parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
        execute: async ({ id }) => `record:${id}`,
      }),
    ],
  });

  const result = await agent.run("lookup 42");
  assert.equal(result.finalText, "record:42");
  assert.equal(result.steps.length, 2);
  assert.equal(result.steps[0]?.toolResults[0]?.content, "record:42");
  assert.equal(result.usage.totalTokens, 17);
  assert.equal(result.usage.cost, 0.03);
});

test("stops when a configured condition is reached", async () => {
  const provider: ModelProvider = {
    async complete() {
      return {
        message: {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: { name: "missing", arguments: "{}" },
            },
          ],
        },
      };
    },
  };

  const agent = new Agent({ model: provider, stopWhen: [stepCountIs(1)] });
  const result = await agent.run("keep going");
  assert.equal(result.stoppedBy, "step_count:1");
});

test("keeps the run-level maxSteps cap with custom stop conditions", async () => {
  let calls = 0;
  const agent = new Agent({
    stopWhen: [maxToolCalls(100)],
    model: {
      async complete() {
        calls += 1;
        return {
          message: {
            role: "assistant",
            content: null,
            tool_calls: [{ id: `call_${calls}`, type: "function", function: { name: "loop", arguments: "{}" } }],
          },
        };
      },
    },
    tools: [defineTool({ name: "loop", execute: () => "continue" })],
  });

  const result = await agent.run({ input: "loop", maxSteps: 2 });

  assert.equal(calls, 2);
  assert.equal(result.stoppedBy, "step_count:2");
});

test("preserves an explicit zero cost in usage", async () => {
  const agent = new Agent({
    model: {
      async complete() {
        return {
          message: { role: "assistant", content: "done" },
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2, cost: 0 },
        };
      },
    },
  });

  const result = await agent.run("finish");
  assert.equal(result.usage.cost, 0);
});
