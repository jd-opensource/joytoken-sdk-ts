import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Agent, createJoyTokenProvider } from "@joytoken/agent-sdk-ts";
import { JoyTokenClient } from "@joytoken/client-sdk-ts";
import { createMockJoyTokenServer, type MockJoyTokenServer } from "../src/mock-server.js";

let server: MockJoyTokenServer;

before(async () => {
  server = await createMockJoyTokenServer();
});

after(async () => {
  await server.close();
});

test("uses client-sdk-ts against a JoyToken-compatible endpoint", async () => {
  const client = new JoyTokenClient({
    apiKey: "example-key",
    apiBaseUrl: server.baseUrl,
    openAIBaseUrl: `${server.baseUrl}/openai/v1`,
  });

  const models = await client.models.list();
  assert.equal(models.data.models[0]?.modelId, "auto");

  const completion = await client.chat.completions.create({
    model: "auto",
    messages: [{ role: "user", content: "ping" }],
  });
  assert.equal(completion.choices[0]?.message.content, "pong");
});

test("uses agent-sdk-ts with JoyToken provider", async () => {
  const agent = new Agent({
    model: createJoyTokenProvider({
      apiKey: "example-key",
      apiBaseUrl: server.baseUrl,
      openAIBaseUrl: `${server.baseUrl}/openai/v1`,
    }),
  });

  const result = await agent.run("ping");
  assert.equal(result.finalText, "pong");
  assert.equal(result.usage.totalTokens, 4);
});
