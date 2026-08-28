import assert from "node:assert/strict";
import { test } from "node:test";
import { JoyTokenClient } from "../src/index.js";

// captureChatTools drives a single chat completion through an injected fetch
// that records the outgoing request body, then returns the declared tool names
// so a test can assert exactly which tools the client advertised to the model.
async function captureChatTools(options: {
  filePermission?: () => boolean;
  shellPermission?: () => boolean;
  excludedDefaultTools?: string[];
}): Promise<string[]> {
  let captured: string[] = [];
  const client = new JoyTokenClient({
    apiKey: "test-key",
    apiBaseUrl: "https://example.invalid",
    openAIBaseUrl: "https://example.invalid/openai/v1",
    ...options,
    fetch: async (_input, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        tools?: Array<{ function?: { name?: string } }>;
      };
      captured = (body.tools ?? []).map((tool) => tool.function?.name ?? "").filter((name) => name !== "");
      return new Response(
        JSON.stringify({
          id: "chatcmpl_test",
          choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        { status: 200, headers: { "Content-Type": "application/json", "X-DAOE-Used-Model": "auto" } },
      );
    },
  });

  await client.chat.completions.create({ model: "auto", messages: [{ role: "user", content: "hi" }] });
  return captured;
}

// Side-effecting tools must always be advertised to the model even when the
// host wires up no permission callback: the model sees the capability, and the
// gate refuses execution at call time. This mirrors the Go
// SideEffectingToolsDeclaredWithoutCallback test.
test("declares file_write and shell even when no permission callbacks are set", async () => {
  const names = await captureChatTools({});
  assert.ok(names.includes("file_write"), `expected file_write to be declared, got ${names.join(", ")}`);
  assert.ok(names.includes("shell"), `expected shell to be declared, got ${names.join(", ")}`);
});

// excludedDefaultTools trims named default local tools without touching the
// rest. This mirrors the Go WithoutDefaultTools test for local tools.
test("excludedDefaultTools removes named default local tools", async () => {
  const names = await captureChatTools({ excludedDefaultTools: ["shell", "file_write"] });
  assert.ok(!names.includes("shell"), `expected shell to be excluded, got ${names.join(", ")}`);
  assert.ok(!names.includes("file_write"), `expected file_write to be excluded, got ${names.join(", ")}`);
  // Non-excluded defaults survive.
  assert.ok(names.includes("calculator"), `expected calculator to remain, got ${names.join(", ")}`);
});