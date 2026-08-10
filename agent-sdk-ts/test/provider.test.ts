import { createServer } from "node:http";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createJoyTokenProvider, type ModelRequest } from "../src/index.js";

let baseUrl = "";
let closeServer: undefined | (() => Promise<void>);
let lastRequest: { url: string; headers: Record<string, string | string[] | undefined>; body: Record<string, unknown> } | undefined;

before(async () => {
  const server = createServer(async (req, res) => {
    const body = JSON.parse(await readBody(req)) as Record<string, unknown>;
    lastRequest = { url: req.url ?? "", headers: req.headers, body };

    if (req.url === "/openai/v1/chat/completions") {
      assert.equal(req.headers.authorization, "Bearer test-key");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "hello" } }], usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } }));
      return;
    }

    if (req.url === "/anthropic/v1/messages") {
      assert.equal(req.headers["x-api-key"], "test-key");
      assert.equal(req.headers["anthropic-version"], "2023-06-01");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        id: "msg_test",
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: "use tool" }, { type: "tool_use", id: "tool_1", name: "lookup", input: { id: "42" } }],
        model: "auto",
        stop_reason: "tool_use",
        usage: { input_tokens: 7, output_tokens: 4 },
      }));
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
    protocol: "openai",
  });
  const response = await provider.complete({ messages: [{ role: "user", content: "hello" }] });

  assert.equal(lastRequest?.url, "/openai/v1/chat/completions");
  assert.equal(response.message.content, "hello");
  assert.equal(response.usage?.total_tokens, 5);
});

test("JoyToken provider converts Agent messages and tools to Anthropic Messages", async () => {
  const provider = createJoyTokenProvider({
    apiKey: "test-key",
    apiBaseUrl: baseUrl,
    anthropicBaseUrl: `${baseUrl}/anthropic/v1`,
    protocol: "anthropic",
  });
  const request: ModelRequest = {
    messages: [
      { role: "system", content: "Be concise" },
      { role: "user", content: "Look up 42" },
      {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "tool_0", type: "function", function: { name: "lookup", arguments: '{"id":"42"}' } }],
      },
      { role: "tool", tool_call_id: "tool_0", content: "record:42" },
    ],
    tools: [{ type: "function", function: { name: "lookup", description: "Find a record", parameters: { type: "object", properties: { id: { type: "string" } } } } }],
    maxTokens: 256,
  };
  const response = await provider.complete(request);

  assert.equal(lastRequest?.url, "/anthropic/v1/messages");
  assert.deepEqual(lastRequest?.body.system, "Be concise");
  assert.equal((lastRequest?.body.messages as Array<{ role: string }>)[0]?.role, "user");
  assert.deepEqual((lastRequest?.body.tools as Array<{ input_schema: unknown }>)[0]?.input_schema, {
    type: "object",
    properties: { id: { type: "string" } },
  });
  assert.equal(response.message.tool_calls?.[0]?.function.name, "lookup");
  assert.equal(response.message.tool_calls?.[0]?.function.arguments, '{"id":"42"}');
  assert.equal(response.usage?.total_tokens, 11);
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
