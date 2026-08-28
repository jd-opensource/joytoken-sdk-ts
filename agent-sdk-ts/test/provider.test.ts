import { createServer } from "node:http";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createJoyTokenProvider } from "../src/index.js";

let baseUrl = "";
let closeServer: undefined | (() => Promise<void>);
let lastRequest: { url: string; headers: Record<string, string | string[] | undefined>; body: Record<string, unknown> } | undefined;
let nextChatResponse: Record<string, unknown> | undefined;

before(async () => {
  const server = createServer(async (req, res) => {
    const body = JSON.parse(await readBody(req)) as Record<string, unknown>;
    lastRequest = { url: req.url ?? "", headers: req.headers, body };

    if (req.url === "/openai/v1/chat/completions") {
      assert.equal(req.headers.authorization, "Bearer test-key");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(nextChatResponse ?? {
        choices: [{ message: { role: "assistant", content: "hello" } }],
        usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
      }));
      nextChatResponse = undefined;
      return;
    }

    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("unexpected server address");
  baseUrl = `http://${address.address}:${address.port}`;
  closeServer = () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
});

after(async () => {
  await closeServer?.();
});

test("JoyToken provider sends OpenAI Chat Completions requests", async () => {
  const provider = createJoyTokenProvider({
    apiKey: "test-key",
    apiBaseUrl: baseUrl,
    openAIBaseUrl: `${baseUrl}/openai/v1`,
  });
  const response = await provider.complete({ messages: [{ role: "user", content: "hello" }] });

  assert.equal(lastRequest?.url, "/openai/v1/chat/completions");
  assert.equal(response.message.content, "hello");
  assert.equal(response.usage?.total_tokens, 5);
});

test("Anthropic provider compatibility still uses the single Chat Completions route", async () => {
  const provider = createJoyTokenProvider({
    apiKey: "test-key",
    apiBaseUrl: baseUrl,
    anthropicBaseUrl: `${baseUrl}/anthropic/v1`,
    protocol: "anthropic",
  });
  const response = await provider.complete({
    messages: [
      { role: "system", content: "be concise" },
      { role: "user", content: "hello" },
    ],
    tools: [],
  });

  assert.equal(lastRequest?.url, "/openai/v1/chat/completions");
  assert.deepEqual(lastRequest?.body.tools, []);
  assert.deepEqual((lastRequest?.body.messages as Array<Record<string, unknown>>)[0], {
    role: "system",
    content: "be concise",
  });
  assert.equal(response.message.content, "hello");
  assert.equal(response.usage?.total_tokens, 5);
});

test("Anthropic provider preserves opaque tool metadata in request and response conversions", async () => {
  const extraContent = {
    google: { thought_signature: "opaque-signature" },
    future_vendor: { nested: { token: "vendor-token" } },
  };
  nextChatResponse = {
    choices: [{
      message: {
        role: "assistant",
        content: null,
        tool_calls: [{
          id: "call_response",
          type: "function",
          function: { name: "echo", arguments: '{"text":"response"}' },
          extra_content: extraContent,
        }],
      },
      finish_reason: "tool_calls",
    }],
    usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
  };
  const provider = createJoyTokenProvider({
    apiKey: "test-key",
    apiBaseUrl: baseUrl,
    protocol: "anthropic",
  });
  const response = await provider.complete({
    messages: [
      { role: "user", content: "echo" },
      {
        role: "assistant",
        content: null,
        tool_calls: [{
          id: "call_request",
          type: "function",
          function: { name: "echo", arguments: '{"text":"request"}' },
          extra_content: extraContent,
        }],
      },
      { role: "tool", tool_call_id: "call_request", content: "request" },
    ],
    tools: [{ type: "function", function: { name: "echo", parameters: { type: "object" } } }],
  });

  const requestMessages = lastRequest?.body.messages as Array<Record<string, any>>;
  assert.deepEqual(requestMessages[1]?.tool_calls[0]?.extra_content, extraContent);
  assert.deepEqual(response.message.tool_calls?.[0]?.extra_content, extraContent);
});

function readBody(req: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}
