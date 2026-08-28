import { createServer } from "node:http";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { JoyTokenClient, JoyTokenAPIError } from "../src/index.js";

let baseUrl = "";
let closeServer: undefined | (() => Promise<void>);

before(async () => {
  const server = createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/api/v1/models") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ object: "list", data: { models: [{ modelId: "auto", modelKey: "auto", displayName: "auto", alias: "auto" }] } }));
      return;
    }

    const validAuth = req.headers.authorization === "Bearer test-key";
    if (!validAuth) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "missing api key" } }));
      return;
    }

    if (req.method === "GET" && req.url === "/api/v1/models/meta") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        code: 0,
        data: {
          tiers: [{ value: "standard", label: "Standard" }],
          skus: [],
          featureTags: [],
          industryPacks: [],
          providers: [{ value: "openai", label: "OpenAI" }],
          updatedAt: "2026-07-27T09:00:00Z",
        },
        message: "success",
      }));
      return;
    }

    if (req.method === "GET" && req.url === "/api/v1/pricing") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        code: 0,
        data: {
          tiers: [{
            code: "standard",
            name: "Standard",
            description: "",
            usdPerCredit: "0.002",
            creditsPerUsd: "500",
            unit: "USD/Credit",
            rateVersion: "2026-07",
            sortOrder: 2,
            updatedAt: "2026-07-27T09:00:00Z",
          }],
          skus: [{ code: "lock", name: "Lock", description: "" }],
          currentVersion: "2026-07",
          updatedAt: "2026-07-27T09:00:00Z",
        },
        message: "success",
      }));
      return;
    }

    if (req.method === "POST" && req.url === "/openai/v1/chat/completions") {
      const body = await readBody(req);
      const payload = JSON.parse(body) as { stream?: boolean };

      if (payload.stream) {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.write('data: {"choices":[{"index":0,"delta":{"content":"hello"},"finish_reason":null}]}\n\n');
        res.write("data: [DONE]\n\n");
        res.end();
        return;
      }

      res.writeHead(200, { "Content-Type": "application/json", "X-DAOE-Used-Model": "auto" });
      res.end(
        JSON.stringify({
          id: "chatcmpl_test",
          choices: [{ index: 0, message: { role: "assistant", content: "hello" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      );
      return;
    }

    if (req.method === "POST" && req.url === "/openai/v1/images/generations") {
      const body = await readBody(req);
      const payload = JSON.parse(body) as { model?: string; prompt?: string; size?: string };
      assert.equal(payload.model, "auto");
      assert.equal(payload.prompt, "A JoyToken logo on a black background");
      assert.equal(payload.size, "1024x1024");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        created: 1793395200,
        data: [{ url: "https://example.com/generated.png", revised_prompt: payload.prompt }],
        metadata: { usage: { credits_used: "1.25" } },
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

test("creates chat completions", async () => {
  const client = new JoyTokenClient({ apiKey: "test-key", apiBaseUrl: baseUrl, openAIBaseUrl: `${baseUrl}/openai/v1` });
  const response = await client.chat.completions.create({
    model: "auto",
    messages: [{ role: "user", content: "hello" }],
  });

  assert.equal(response.choices[0]?.message.content, "hello");
});

test("streams chat completions", async () => {
  const client = new JoyTokenClient({ apiKey: "test-key", apiBaseUrl: baseUrl, openAIBaseUrl: `${baseUrl}/openai/v1` });
  const chunks = [];
  for await (const chunk of client.chat.completions.stream({
    model: "auto",
    messages: [{ role: "user", content: "hello" }],
  })) {
    chunks.push(chunk);
  }

  assert.equal(chunks[0]?.choices[0]?.delta.content, "hello");
});

test("generates images", async () => {
  const client = new JoyTokenClient({ apiKey: "test-key", apiBaseUrl: baseUrl, openAIBaseUrl: `${baseUrl}/openai/v1` });
  const response = await client.images.generate({
    model: "auto",
    prompt: "A JoyToken logo on a black background",
    size: "1024x1024",
  });

  assert.equal(response.data[0]?.url, "https://example.com/generated.png");
  assert.deepEqual(response.metadata?.usage, { credits_used: "1.25" });
});

test("lists models", async () => {
  const client = new JoyTokenClient({ apiKey: "test-key", apiBaseUrl: baseUrl, openAIBaseUrl: `${baseUrl}/openai/v1` });
  const models = await client.models.list();
  assert.equal(models.data.models[0]?.modelId, "auto");
});

test("rejects concrete model IDs before sending a request", async () => {
  let requests = 0;
  const client = new JoyTokenClient({
    apiKey: "test-key",
    fetch: async () => {
      requests += 1;
      throw new Error("unexpected request");
    },
  });
  const concreteModel = "unsupported-model" as "auto";

  const calls = [
    () => client.chat.completions.create({ model: concreteModel, messages: [] }),
    () => client.chat.completions.stream({ model: concreteModel, messages: [] })[Symbol.asyncIterator]().next(),
    () => client.images.generate({ model: concreteModel, prompt: "hello" }),
  ];

  for (const call of calls) {
    await assert.rejects(call, /model must be "auto"/);
  }
  assert.equal(requests, 0);
});

test("lists localized model descriptions", async () => {
  let requestedURL = "";
  const client = new JoyTokenClient({
    fetch: async (input) => {
      requestedURL = String(input);
      return Response.json({
        code: 0,
        message: "success",
        data: {
          models: [{
            modelId: "auto",
            modelKey: "auto",
            displayName: "auto",
            alias: "auto",
            tier: "standard",
            tags: ["lock"],
            description: "localized",
            customerInputMtok: 200,
            customerOutputMtok: 900,
            customerCachereadMtok: 20,
            customerCachewriteMtok: 250,
            customerImageInputMtok: "",
            customerImageOutputMtok: "",
            customerImageCachedInputMtok: "",
            provider: "auto",
            featureTags: ["agent"],
            scenarioTags: [],
            mciScore: 7.57,
          }],
        },
      });
    },
  });

  const models = await client.models.list({ locale: "zh" });
  assert.equal(new URL(requestedURL).searchParams.get("locale"), "zh");
  assert.equal(models.data.models[0]?.modelId, "auto");
  assert.equal(models.data.models[0]?.displayName, "auto");
  assert.equal(models.data.models[0]?.customerCachereadMtok, 20);
  await assert.rejects(() => client.models.list({ locale: "zh-CN" as "zh" }), /model locale/);
});

test("retrieves model catalog metadata and pricing", async () => {
  const client = new JoyTokenClient({ apiKey: "test-key", apiBaseUrl: baseUrl });

  const meta = await client.models.meta();
  assert.equal(meta.data.providers[0]?.value, "openai");

  const pricing = await client.pricing.retrieve();
  assert.equal(pricing.data.tiers[0]?.creditsPerUsd, "500");
  assert.equal(pricing.data.skus[0]?.code, "lock");
});

test("lists models without an API key", async () => {
  const client = new JoyTokenClient({ apiBaseUrl: baseUrl, openAIBaseUrl: `${baseUrl}/openai/v1` });
  const models = await client.models.list();
  assert.equal(models.data.models[0]?.modelId, "auto");
});

test("rejects authenticated requests locally when the API key is missing", async () => {
  let requestCount = 0;
  const client = new JoyTokenClient({
    apiKey: "  ",
    fetch: async () => {
      requestCount += 1;
      return Response.json({});
    },
  });

  const expected = /JoyToken API key is required/;
  await assert.rejects(() => client.chat.completions.create({ model: "auto", messages: [] }), expected);
  await assert.rejects(() => client.images.generate({ model: "auto", prompt: "hello" }), expected);
  await assert.rejects(() => client.models.meta(), expected);
  await assert.rejects(() => client.pricing.retrieve(), expected);
  assert.equal(requestCount, 0);
});

test("applies timeout while consuming a response body", async () => {
  const client = new JoyTokenClient({
    timeoutMs: 20,
    fetch: async (_input, init) =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            const abort = () => controller.error(new DOMException("The operation was aborted.", "AbortError"));
            if (init?.signal?.aborted) {
              abort();
              return;
            }
            init?.signal?.addEventListener("abort", abort, { once: true });
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
  });

  await assert.rejects(() => client.models.list(), /abort/i);
});

test("keeps SDK authentication and request headers authoritative", async () => {
  const observed: Headers[] = [];
  const client = new JoyTokenClient({
    apiKey: "test-key",
    defaultHeaders: {
      Authorization: "Bearer custom",
      "x-api-key": "custom-key",
    },
    fetch: async (_input, init) => {
      observed.push(new Headers(init?.headers));
      return Response.json({ choices: [{ message: { role: "assistant", content: "hello" } }] });
    },
  });

  await client.chat.completions.create({ model: "auto", messages: [] });

  assert.equal(observed[0]?.get("Authorization"), "Bearer test-key");
  assert.equal(observed[0]?.has("x-api-key"), false);
});

test("parses a final SSE event without a trailing newline", async () => {
  const body = 'data: {"choices":[{"index":0,"delta":{"content":"hello"}}]}';
  const client = new JoyTokenClient({
    apiKey: "test-key",
    fetch: async () => new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } }),
  });

  const chunks = [];
  for await (const chunk of client.chat.completions.stream({ model: "auto", messages: [] })) {
    chunks.push(chunk);
  }

  assert.equal(chunks[0]?.choices[0]?.delta.content, "hello");
});

test("cancels an SSE response when iteration stops early", async () => {
  let cancelled = false;
  const client = new JoyTokenClient({
    apiKey: "test-key",
    fetch: async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode('data: {"choices":[{"index":0,"delta":{"content":"hello"}}]}\n\n'),
            );
          },
          cancel() {
            cancelled = true;
          },
        }),
        { status: 200, headers: { "Content-Type": "text/event-stream" } },
      ),
  });

  for await (const _chunk of client.chat.completions.stream({ model: "auto", messages: [] })) {
    break;
  }

  assert.equal(cancelled, true);
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
