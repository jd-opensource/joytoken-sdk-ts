import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  JoyTokenAPIError,
  JoyTokenClient,
  defineTool,
  type ChatCompletionResponse,
  type ChatTool,
  type Response as JoyTokenResponse,
} from "../src/index.js";

interface CapturedRequest {
  url: string;
  body: Record<string, any>;
  headers: Headers;
}

function chatResponse(options: {
  id?: string;
  model?: string;
  content?: string | null;
  toolName?: string;
  arguments?: string;
  extraContent?: Record<string, unknown>;
  thoughtSignature?: string;
  finishReason?: string;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
} = {}): ChatCompletionResponse {
  const toolCalls = options.toolName
    ? [{
        id: "call_1",
        type: "function" as const,
        function: { name: options.toolName, arguments: options.arguments ?? "{}" },
        ...(options.thoughtSignature === undefined ? {} : { thought_signature: options.thoughtSignature }),
        ...(options.extraContent === undefined ? {} : { extra_content: options.extraContent }),
      }]
    : undefined;
  return {
    id: options.id ?? "chat_1",
    object: "chat.completion",
    created: 123,
    model: options.model ?? "model_1",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: options.content ?? (toolCalls ? null : "ok"), ...(toolCalls ? { tool_calls: toolCalls } : {}) },
        finish_reason: options.finishReason ?? (toolCalls ? "tool_calls" : "stop"),
      },
    ],
    usage: options.usage ?? { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
  };
}

function nativeResponse(options: {
  id?: string;
  model?: string;
  text?: string;
  callId?: string;
  toolName?: string;
  arguments?: string;
  output?: JoyTokenResponse["output"];
  usage?: JoyTokenResponse["usage"];
  status?: string;
} = {}): JoyTokenResponse {
  const output = options.output ?? (options.toolName
    ? [{
        id: `fc_${options.callId ?? "call_1"}`,
        type: "function_call",
        status: "completed",
        call_id: options.callId ?? "call_1",
        name: options.toolName,
        arguments: options.arguments ?? "{}",
      }]
    : [{
        id: `msg_${options.id ?? "resp_1"}`,
        type: "message",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text: options.text ?? "ok", annotations: [] }],
      }]);
  return {
    id: options.id ?? "resp_1",
    object: "response",
    status: options.status ?? "completed",
    model: options.model ?? "model_1",
    output,
    usage: options.usage ?? { input_tokens: 2, output_tokens: 3, total_tokens: 5 },
  };
}

function mockClient(
  replies: Array<ChatCompletionResponse | JoyTokenResponse | Response>,
  options: ConstructorParameters<typeof JoyTokenClient>[0] = {},
): { client: JoyTokenClient; requests: CapturedRequest[] } {
  const requests: CapturedRequest[] = [];
  let index = 0;
  const client = new JoyTokenClient({
    apiKey: "test-key",
    apiBaseUrl: "https://gateway.test/",
    maxRetries: 0,
    ...options,
    fetch: async (input, init) => {
      requests.push({
        url: String(input),
        body: JSON.parse(String(init?.body ?? "{}")),
        headers: new Headers(init?.headers),
      });
      const reply = replies[Math.min(index++, replies.length - 1)];
      if (reply instanceof Response) return reply;
      return Response.json(reply);
    },
  });
  return { client, requests };
}

const customChatTool: ChatTool = {
  type: "function",
  function: { name: "custom", description: "custom declaration", parameters: { type: "object" } },
};

const opaqueExtraContent = {
  google: { thought_signature: "opaque-signature", provider_flag: "keep-me" },
  future_vendor: { nested: { token: "vendor-token" }, values: [1, 2, 3] },
};

test("Chat selects exactly one tools owner for undefined, empty, request, and Client tools", async () => {
  const cases = [
    { name: "defaults", request: {}, expected: ["calculator", "datetime", "file_search", "list_dir", "file_read", "file_write", "shell"] },
    { name: "explicit empty", request: { tools: [] }, expected: [] },
    { name: "request", request: { tools: [customChatTool] }, expected: ["custom"] },
  ];
  for (const item of cases) {
    const { client, requests } = mockClient([chatResponse()]);
    await client.chat.completions.create({ model: "auto", messages: [{ role: "user", content: item.name }], ...item.request });
    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.url, "https://gateway.test/openai/v1/chat/completions");
    assert.deepEqual(
      (requests[0]?.body.tools ?? []).map((tool: ChatTool) => tool.function?.name),
      item.expected,
    );
    if (item.name === "explicit empty") assert.deepEqual(requests[0]?.body.tools, []);
  }

  const registered = defineTool({ name: "registered", parameters: { type: "object" }, execute: () => "done" });
  const { client, requests } = mockClient([chatResponse()], { tools: [registered] });
  await client.chat.completions.create({ model: "auto", messages: [] });
  assert.deepEqual(requests[0]?.body.tools.map((tool: ChatTool) => tool.function.name), ["registered"]);
});

test("Chat create never executes request or registered user tools and same-name defaults cannot intercept", async () => {
  let executions = 0;
  const registered = defineTool({ name: "custom", execute: () => { executions += 1; return "registered"; } });
  const requestCalculator: ChatTool = {
    type: "function",
    function: { name: "calculator", description: "user calculator", parameters: { type: "object" } },
  };
  const first = mockClient([chatResponse({ toolName: "calculator", arguments: '{"value":1}' })], { tools: [registered] });
  const result = await first.client.chat.completions.create({ model: "auto", messages: [], tools: [requestCalculator] });
  assert.equal(first.requests.length, 1);
  assert.equal(executions, 0);
  assert.deepEqual(first.requests[0]?.body.tools, [requestCalculator]);
  assert.equal(result.choices[0]?.message.tool_calls?.[0]?.function.name, "calculator");

  const second = mockClient([chatResponse({ toolName: "custom" })], { tools: [registered] });
  await second.client.chat.completions.create({ model: "auto", messages: [] });
  assert.equal(second.requests.length, 1);
  assert.equal(executions, 0);
});

test("Chat run executes registered handlers once, reuses the first response, and returns final metadata", async () => {
  let executions = 0;
  const registered = defineTool({
    name: "custom",
    execute: (input) => { executions += 1; return { echoed: input }; },
  });
  const { client, requests } = mockClient(
    [
      chatResponse({ id: "first", model: "first-model", toolName: "custom", arguments: '{"n":7}', usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }),
      chatResponse({ id: "final", model: "final-model", content: "finished", usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 } }),
    ],
    { tools: [registered] },
  );
  const result = await client.chat.completions.run({
    model: "auto",
    messages: [{ role: "user", content: "go" }],
    tool_choice: "auto",
    parallel_tool_calls: true,
    temperature: 0.2,
    store: false,
    metadata: { source: "test" },
  });
  assert.equal(requests.length, 2);
  assert.equal(executions, 1);
  assert.deepEqual(requests[1]?.body.tools, requests[0]?.body.tools);
  assert.equal(requests[1]?.body.tools.length, 1);
  assert.equal(requests[1]?.body.tool_choice, "auto");
  assert.equal(requests[1]?.body.parallel_tool_calls, true);
  assert.equal(requests[1]?.body.temperature, 0.2);
  assert.equal(requests[1]?.body.store, false);
  assert.deepEqual(requests[1]?.body.metadata, { source: "test" });
  assert.equal(requests[1]?.body.messages.at(-1)?.role, "tool");
  assert.match(requests[1]?.body.messages.at(-1)?.content, /"n":7/);
  assert.equal(result.id, "final");
  assert.equal(result.model, "final-model");
  assert.deepEqual(result.usage, { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 });
});

test("Chat run replays opaque ToolCall extra_content exactly once without changing tools", async () => {
  let executions = 0;
  let executionExtraContent: unknown;
  const echo = defineTool({
    name: "echo",
    execute: (_input, context) => {
      executions += 1;
      executionExtraContent = context.toolCall.extra_content;
      return "echoed";
    },
  });
  const { client, requests } = mockClient([
    chatResponse({ toolName: "echo", arguments: '{"text":"hello"}', extraContent: opaqueExtraContent }),
    chatResponse({ id: "chat-final", content: "done" }),
  ], { tools: [echo] });

  await client.chat.completions.run({ model: "auto", messages: [{ role: "user", content: "echo" }] });

  assert.equal(requests.length, 2);
  assert.equal(executions, 1);
  assert.deepEqual(executionExtraContent, opaqueExtraContent);
  assert.equal(requests[0]?.body.tools.length, 1);
  assert.equal(requests[1]?.body.tools.length, 1);
  assert.deepEqual(requests[1]?.body.tools, requests[0]?.body.tools);
  assert.deepEqual(requests[1]?.body.messages.at(-2)?.tool_calls[0]?.extra_content, opaqueExtraContent);
});

test("Chat run replays top-level thought_signature verbatim on the continuation turn", async () => {
  const echo = defineTool({ name: "echo", execute: () => "echoed" });
  const { client, requests } = mockClient([
    chatResponse({ toolName: "echo", arguments: '{"text":"hi"}', thoughtSignature: "gemini-top-level-sig" }),
    chatResponse({ id: "chat-final", content: "done" }),
  ], { tools: [echo] });

  await client.chat.completions.run({ model: "auto", messages: [{ role: "user", content: "echo" }] });

  assert.equal(requests.length, 2);
  const replayed = requests[1]?.body.messages.at(-2)?.tool_calls[0];
  // The top-level signature (sibling of id/type/function) must be echoed back
  // verbatim, otherwise Gemini rejects the continuation with a 503.
  assert.equal(replayed?.thought_signature, "gemini-top-level-sig");
});

test("Chat run preserves both top-level thought_signature and nested extra_content together", async () => {
  const echo = defineTool({ name: "echo", execute: () => "echoed" });
  const { client, requests } = mockClient([
    chatResponse({
      toolName: "echo",
      arguments: "{}",
      thoughtSignature: "top-sig",
      extraContent: opaqueExtraContent,
    }),
    chatResponse({ id: "chat-final", content: "done" }),
  ], { tools: [echo] });

  await client.chat.completions.run({ model: "auto", messages: [{ role: "user", content: "echo" }] });

  const replayed = requests[1]?.body.messages.at(-2)?.tool_calls[0];
  assert.equal(replayed?.thought_signature, "top-sig");
  assert.deepEqual(replayed?.extra_content, opaqueExtraContent);
});

test("tool calls without thought_signature do not synthesize an empty field", async () => {
  const echo = defineTool({ name: "echo", execute: () => "echoed" });
  const { client, requests } = mockClient([
    chatResponse({ toolName: "echo", arguments: "{}" }),
    chatResponse({ id: "chat-final", content: "done" }),
  ], { tools: [echo] });

  await client.chat.completions.run({ model: "auto", messages: [{ role: "user", content: "echo" }] });

  const replayed = requests[1]?.body.messages.at(-2)?.tool_calls[0];
  assert.equal("thought_signature" in replayed, false);
});

test("Chat runStream aggregates a top-level thought_signature streamed across deltas", async () => {
  const echo = defineTool({ name: "echo", execute: () => "echoed" });
  const streamed = new Response(
    'data: {"id":"s1","model":"m","choices":[{"index":0,"delta":{"role":"assistant","tool_calls":[{"index":0,"id":"call_s","type":"function","function":{"name":"echo","arguments":"{}"},"thought_signature":"streamed-sig"}]},"finish_reason":"tool_calls"}]}\n\ndata: [DONE]\n\n',
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  );
  const final = new Response(
    'data: {"id":"s2","model":"m","choices":[{"index":0,"delta":{"role":"assistant","content":"done"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  );
  const { client, requests } = mockClient([streamed, final], { tools: [echo] });

  await client.chat.completions.runStream({ model: "auto", messages: [{ role: "user", content: "echo" }] });

  const replayed = requests[1]?.body.messages.at(-2)?.tool_calls[0];
  assert.equal(replayed?.thought_signature, "streamed-sig");
});

test("Chat run annotates continuation HTTP errors without retrying or re-executing tools", async () => {
  let executions = 0;
  const echo = defineTool({
    name: "echo",
    execute: () => {
      executions += 1;
      return "echoed";
    },
  });
  const failureBody = {
    error: { code: "INVALID_ARGUMENT", message: "Function call is missing provider metadata" },
  };
  const failure = new Response(JSON.stringify(failureBody), {
    status: 400,
    headers: { "Content-Type": "application/json", "x-request-id": "req_chat_continuation" },
  });
  const { client, requests } = mockClient([
    chatResponse({ toolName: "echo", extraContent: opaqueExtraContent }),
    failure,
  ], { tools: [echo] });

  await assert.rejects(
    () => client.chat.completions.run({ model: "auto", messages: [] }),
    (error: unknown) => {
      assert.ok(error instanceof JoyTokenAPIError);
      assert.equal(error.status, 400);
      assert.equal(error.code, "invalid_request");
      assert.equal(error.requestId, "req_chat_continuation");
      assert.equal(error.message, "Function call is missing provider metadata");
      assert.deepEqual(error.body, failureBody);
      assert.deepEqual(error.context, {
        protocol: "chat",
        phase: "tool_continuation",
        requestNumber: 2,
        toolStep: 1,
        toolCalls: [{ id: "call_1", name: "echo", hasExtraContent: true, hasThoughtSignature: false }],
      });
      return true;
    },
  );

  assert.equal(requests.length, 2);
  assert.equal(executions, 1);
  assert.deepEqual(requests[1]?.body.tools, requests[0]?.body.tools);
});

test("Chat initial HTTP errors are identified before any tool executes", async () => {
  let executions = 0;
  const echo = defineTool({ name: "echo", execute: () => { executions += 1; return "echoed"; } });
  const failure = new Response(JSON.stringify({ error: { message: "provider unavailable" } }), {
    status: 503,
    headers: { "Content-Type": "application/json" },
  });
  const { client, requests } = mockClient([failure], { tools: [echo] });

  await assert.rejects(
    () => client.chat.completions.run({ model: "auto", messages: [] }),
    (error: unknown) => {
      assert.ok(error instanceof JoyTokenAPIError);
      assert.deepEqual(error.context, {
        protocol: "chat",
        phase: "initial_request",
        requestNumber: 1,
      });
      return true;
    },
  );

  assert.equal(requests.length, 1);
  assert.equal(executions, 0);
});

test("Chat defaults auto-run without a duplicate first request", async () => {
  const { client, requests } = mockClient([
    chatResponse({ id: "first", toolName: "calculator", arguments: '{"expression":"(2 + 3) * 4"}' }),
    chatResponse({ id: "final", content: "20" }),
  ]);
  const result = await client.chat.completions.create({ model: "auto", messages: [{ role: "user", content: "calculate" }] });
  assert.equal(requests.length, 2);
  assert.match(requests[1]?.body.messages.at(-1)?.content, /20/);
  assert.equal(result.id, "final");
});

test("Chat run returns a structured tool_handler_not_found result without falling back to defaults", async () => {
  const calculator: ChatTool = {
    type: "function",
    function: { name: "calculator", description: "user-owned schema", parameters: { type: "object" } },
  };
  const { client, requests } = mockClient([
    chatResponse({ toolName: "calculator", arguments: '{"value":1}' }),
    chatResponse({ id: "handled-error", content: "handler missing" }),
  ]);
  await client.chat.completions.run({ model: "auto", messages: [], tools: [calculator] });
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[1]?.body.tools, [calculator]);
  const result = JSON.parse(requests[1]?.body.messages.at(-1)?.content);
  assert.equal(result.error.type, "tool_handler_not_found");
  assert.equal(result.error.tool, "calculator");
});

test("Chat stream preserves explicit empty tools and never executes", async () => {
  const sse = new Response(
    'data: {"id":"stream_1","model":"m","choices":[{"index":0,"delta":{"role":"assistant","tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"custom","arguments":"{}"}}]},"finish_reason":"tool_calls"}]}\n\ndata: [DONE]\n\n',
    { headers: { "Content-Type": "text/event-stream" } },
  );
  const { client, requests } = mockClient([sse]);
  const chunks = [];
  for await (const chunk of client.chat.completions.stream({ model: "auto", messages: [], tools: [] })) chunks.push(chunk);
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0]?.body.tools, []);
  assert.equal(chunks[0]?.choices[0]?.delta.tool_calls?.[0]?.function.name, "custom");
});

test("Chat runStream keeps effective tools and reports text/tool callbacks", async () => {
  const first = new Response(
    'data: {"id":"cs1","model":"m","choices":[{"index":0,"delta":{"role":"assistant","tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"echo","arguments":"{\\"value\\":1}"}}]},"finish_reason":"tool_calls"}]}\n\ndata: [DONE]\n\n',
    { headers: { "Content-Type": "text/event-stream" } },
  );
  const second = new Response(
    'data: {"id":"cs2","model":"m","choices":[{"index":0,"delta":{"role":"assistant","content":"done"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
    { headers: { "Content-Type": "text/event-stream" } },
  );
  const echo = defineTool({ name: "echo", execute: () => "echoed" });
  const { client, requests } = mockClient([first, second], { tools: [echo] });
  const deltas: string[] = [];
  const results: string[] = [];
  const response = await client.chat.completions.runStream(
    { model: "auto", messages: [], tool_choice: "auto", parallel_tool_calls: false, store: false },
    { onTextDelta: (delta) => deltas.push(delta), onToolResult: (result) => results.push(result.content) },
  );
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[1]?.body.tools, requests[0]?.body.tools);
  assert.equal(requests[1]?.body.tool_choice, "auto");
  assert.equal(requests[1]?.body.parallel_tool_calls, false);
  assert.equal(requests[1]?.body.store, false);
  assert.deepEqual(deltas, ["done"]);
  assert.deepEqual(results, ["echoed"]);
  assert.equal(response.id, "cs2");
});

test("Chat runStream recursively merges and replays fragmented opaque tool metadata", async () => {
  let executions = 0;
  let executionExtraContent: unknown;
  const first = new Response(
    'data: {"id":"opaque-stream","model":"m","choices":[{"index":0,"delta":{"role":"assistant","tool_calls":[{"index":0,"id":"call_opaque","type":"function","function":{"name":"echo"},"extra_content":{"google":{"thought_signature":"opaque-signature","first":true},"future_vendor":{"nested":{"a":1},"values":[1]}}}]},"finish_reason":null}]}\n\ndata: {"id":"opaque-stream","model":"m","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"text\\":\\"hello\\"}"},"extra_content":{"google":{"second":"kept"},"future_vendor":{"nested":{"b":2},"values":[2,3]}}}]},"finish_reason":null}]}\n\ndata: {"id":"opaque-stream","model":"m","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{}}]},"finish_reason":"tool_calls"}]}\n\ndata: [DONE]\n\n',
    { headers: { "Content-Type": "text/event-stream" } },
  );
  const final = new Response(
    'data: {"id":"opaque-final","model":"m","choices":[{"index":0,"delta":{"role":"assistant","content":"done"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
    { headers: { "Content-Type": "text/event-stream" } },
  );
  const echo = defineTool({
    name: "echo",
    execute: (_input, context) => {
      executions += 1;
      executionExtraContent = context.toolCall.extra_content;
      return "echoed";
    },
  });
  const { client, requests } = mockClient([first, final], { tools: [echo] });

  await client.chat.completions.runStream({ model: "auto", messages: [] });

  const expected = {
    google: { thought_signature: "opaque-signature", first: true, second: "kept" },
    future_vendor: { nested: { a: 1, b: 2 }, values: [2, 3] },
  };
  assert.equal(requests.length, 2);
  assert.equal(executions, 1);
  assert.deepEqual(executionExtraContent, expected);
  assert.deepEqual(requests[1]?.body.messages.at(-2)?.tool_calls[0]?.extra_content, expected);
  assert.equal(requests[1]?.body.messages.at(-2)?.tool_calls[0]?.function.arguments, '{"text":"hello"}');
  assert.deepEqual(requests[1]?.body.tools, requests[0]?.body.tools);
  assert.equal(requests[1]?.body.tools.length, 1);
});

test("Chat runStream annotates continuation errors without another tool execution", async () => {
  let executions = 0;
  const first = new Response(
    'data: {"id":"stream-error","model":"m","choices":[{"index":0,"delta":{"role":"assistant","tool_calls":[{"index":0,"id":"call_stream_error","type":"function","function":{"name":"echo","arguments":"{}"},"extra_content":{"vendor":{"opaque":"value"}}}]},"finish_reason":"tool_calls"}]}\n\ndata: [DONE]\n\n',
    { headers: { "Content-Type": "text/event-stream" } },
  );
  const failure = new Response(JSON.stringify({ error: { message: "continuation rejected" } }), {
    status: 400,
    headers: { "Content-Type": "application/json" },
  });
  const echo = defineTool({ name: "echo", execute: () => { executions += 1; return "echoed"; } });
  const { client, requests } = mockClient([first, failure], { tools: [echo] });

  await assert.rejects(
    () => client.chat.completions.runStream({ model: "auto", messages: [] }),
    (error: unknown) => {
      assert.ok(error instanceof JoyTokenAPIError);
      assert.deepEqual(error.context, {
        protocol: "chat",
        phase: "tool_continuation",
        requestNumber: 2,
        toolStep: 1,
        toolCalls: [{ id: "call_stream_error", name: "echo", hasExtraContent: true, hasThoughtSignature: false }],
      });
      return true;
    },
  );

  assert.equal(requests.length, 2);
  assert.equal(executions, 1);
});

test("tool calls without extra_content do not synthesize empty provider metadata", async () => {
  const echo = defineTool({ name: "echo", execute: () => "echoed" });
  const chat = mockClient([
    chatResponse({ toolName: "echo" }),
    chatResponse({ content: "done" }),
  ], { tools: [echo] });
  await chat.client.chat.completions.run({ model: "auto", messages: [] });
  const replayedCall = chat.requests[1]?.body.messages.at(-2)?.tool_calls[0];
  assert.equal("extra_content" in replayedCall, false);

  const messages = mockClient([chatResponse({ toolName: "echo" })]);
  const response = await messages.client.messages.create({
    model: "auto",
    max_tokens: 32,
    messages: [],
    tools: [{ name: "echo", input_schema: { type: "object" } }],
  });
  const toolUse = response.content.find((block) => block.type === "tool_use")!;
  assert.equal("extra_content" in toolUse, false);
});

test("Responses sends and preserves native Responses payloads", async () => {
  const { client, requests } = mockClient([nativeResponse({ id: "resp_native", model: "used-model", text: "hello" })]);
  const response = await client.responses.create({
    model: "auto",
    input: "hi",
    instructions: "be concise",
    max_output_tokens: 42,
    tools: [],
  });
  assert.equal(requests[0]?.url, "https://gateway.test/openai/v1/responses");
  assert.equal(requests[0]?.body.input, "hi");
  assert.equal(requests[0]?.body.instructions, "be concise");
  assert.equal(requests[0]?.body.max_output_tokens, 42);
  assert.deepEqual(requests[0]?.body.tools, []);
  assert.equal("messages" in requests[0]!.body, false);
  assert.equal(response.id, "resp_native");
  assert.equal(response.model, "used-model");
  assert.equal(response.status, "completed");
  assert.equal(response.output_text, "hello");
  assert.equal(response.output?.[0]?.content?.[0]?.text, "hello");
  assert.deepEqual(response.usage, { input_tokens: 2, output_tokens: 3, total_tokens: 5 });
});

test("Responses preserves hosted tools, distinguishes local file_search, and keeps hosted defaults opt-in", async () => {
  const tools = [
    { type: "web_search_preview", search_context_size: "low" },
    { type: "file_search", vector_store_ids: ["vs_1"] },
    { type: "function", name: "file_search", parameters: { type: "object" } },
  ];
  const explicit = mockClient([nativeResponse()]);
  await explicit.client.responses.create({ model: "auto", input: "search", tools });
  assert.deepEqual(explicit.requests[0]?.body.tools[0], tools[0]);
  assert.deepEqual(explicit.requests[0]?.body.tools[1], tools[1]);
  assert.equal(explicit.requests[0]?.body.tools[2]?.type, "function");
  assert.equal(explicit.requests[0]?.body.tools[2]?.name, "file_search");

  const normal = mockClient([nativeResponse()], { defaultLocalTools: false });
  await normal.client.responses.create({ model: "auto", input: "normal" });
  assert.equal(normal.requests[0]?.body.tools, undefined);

  const optedIn = mockClient([nativeResponse()], { defaultLocalTools: false, defaultBuiltinTools: true });
  await optedIn.client.responses.create({ model: "auto", input: "hosted" });
  assert.deepEqual(optedIn.requests[0]?.body.tools, [{ type: "web_search_preview" }]);

  const invalid = mockClient([nativeResponse()]);
  await assert.rejects(
    () => invalid.client.responses.create({ model: "auto", input: "invalid", tools: [{ type: "file_search" }] }),
    /file_search requires a non-empty vector_store_ids array/,
  );
  assert.equal(invalid.requests.length, 0);
});

test("Responses keeps native function history, flat tools, and native tool_choice", async () => {
  const { client, requests } = mockClient([nativeResponse({ toolName: "lookup", arguments: '{"id":"42"}' })]);
  const response = await client.responses.create({
    model: "auto",
    input: [
      { type: "message", role: "user", content: [{ type: "input_text", text: "find 42" }] },
      { type: "function_call", call_id: "old_call", name: "lookup", arguments: '{"id":"41"}' },
      { type: "function_call_output", call_id: "old_call", output: "record 41" },
    ],
    tools: [{ type: "function", name: "lookup", parameters: { type: "object" } }],
    tool_choice: { type: "function", name: "lookup" },
  });
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.url, "https://gateway.test/openai/v1/responses");
  assert.deepEqual(requests[0]?.body.input[1], { type: "function_call", call_id: "old_call", name: "lookup", arguments: '{"id":"41"}' });
  assert.deepEqual(requests[0]?.body.input[2], { type: "function_call_output", call_id: "old_call", output: "record 41" });
  assert.deepEqual(requests[0]?.body.tools, [{ type: "function", name: "lookup", parameters: { type: "object" } }]);
  assert.deepEqual(requests[0]?.body.tool_choice, { type: "function", name: "lookup" });
  assert.equal(response.output?.[0]?.type, "function_call");
  assert.equal(response.output?.[0]?.call_id, "call_1");
});

test("Responses registered handlers require run and final output comes from the last native round", async () => {
  let executions = 0;
  const tool = defineTool({ name: "lookup", execute: () => { executions += 1; return "found"; } });
  const primitive = mockClient([nativeResponse({ toolName: "lookup" })], { tools: [tool] });
  await primitive.client.responses.create({ model: "auto", input: "find" });
  assert.equal(primitive.requests.length, 1);
  assert.deepEqual(primitive.requests[0]?.body.tools.map((item: Record<string, unknown>) => item.name), ["lookup"]);
  assert.equal(executions, 0);

  const runner = mockClient([
    nativeResponse({ id: "r1", toolName: "lookup" }),
    nativeResponse({ id: "r2", model: "last", text: "found" }),
  ], { tools: [tool] });
  const response = await runner.client.responses.run({ model: "auto", input: "find" });
  assert.equal(runner.requests.length, 2);
  assert.deepEqual(runner.requests[0]?.body.tools.map((item: Record<string, unknown>) => item.name), ["lookup"]);
  assert.deepEqual(runner.requests[1]?.body.tools, runner.requests[0]?.body.tools);
  assert.equal(runner.requests[1]?.body.input.at(-1)?.type, "function_call_output");
  assert.equal(executions, 1);
  assert.equal(response.id, "r2");
  assert.equal(response.model, "last");
  assert.equal(response.output_text, "found");
});

test("Responses defaults auto-run natively and tool_choice is unchanged", async () => {
  const automatic = mockClient([
    nativeResponse({ id: "d1", toolName: "calculator", arguments: '{"expression":"9 % 4"}' }),
    nativeResponse({ id: "d2", text: "1" }),
  ]);
  const result = await automatic.client.responses.create({ model: "auto", input: "calculate" });
  assert.equal(automatic.requests.length, 2);
  assert.ok(automatic.requests.every((request) => request.url === "https://gateway.test/openai/v1/responses"));
  assert.deepEqual(automatic.requests[1]?.body.tools, automatic.requests[0]?.body.tools);
  assert.match(automatic.requests[1]?.body.input.at(-1)?.output, /1/);
  assert.equal(result.id, "d2");

  const cases = [
    { input: "auto" as const, expected: "auto" },
    { input: "none" as const, expected: "none" },
    { input: "required" as const, expected: "required" },
    { input: { type: "function" as const, name: "lookup" }, expected: { type: "function", name: "lookup" } },
  ];
  for (const item of cases) {
    const current = mockClient([nativeResponse()]);
    await current.client.responses.create({ model: "auto", input: "choice", tools: [], tool_choice: item.input });
    assert.deepEqual(current.requests[0]?.body.tool_choice, item.expected);
  }
});

test("Responses stream forwards native Responses SSE events", async () => {
  const final = nativeResponse({ id: "s1", model: "m1", text: "hello" });
  const sse = new Response(
    `data: {"type":"response.created","sequence_number":0,"response":{"id":"s1","object":"response","status":"in_progress","model":"m1","output":[]}}\n\ndata: {"type":"response.output_text.delta","sequence_number":1,"delta":"hello"}\n\ndata: {"type":"response.completed","sequence_number":2,"response":${JSON.stringify(final)}}\n\ndata: [DONE]\n\n`,
    { headers: { "Content-Type": "text/event-stream" } },
  );
  const { client, requests } = mockClient([sse]);
  const events = [];
  for await (const event of client.responses.stream({ model: "auto", input: "hi", tools: [] })) events.push(event);
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.url, "https://gateway.test/openai/v1/responses");
  assert.equal(requests[0]?.body.stream, true);
  assert.deepEqual(requests[0]?.body.tools, []);
  assert.deepEqual(events.map((event) => event.type), ["response.created", "response.output_text.delta", "response.completed"]);
  assert.equal(events[1]?.delta, "hello");
  const completed = events.at(-1);
  assert.equal(completed?.type, "response.completed");
  assert.deepEqual(completed?.response, final);
});

test("Responses stream does not synthesize Responses events from Chat-shaped SSE", async () => {
  const sse = new Response(
    'data: {"id":"sf","model":"m","choices":[{"index":0,"delta":{"role":"assistant","tool_calls":[{"index":0,"id":"call_f","type":"function","function":{"name":"lookup","arguments":"{\\\"id\\\":"}}]},"finish_reason":null}]}\n\ndata: {"id":"sf","model":"m","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"42}"}}],"content":"after"},"finish_reason":"tool_calls"}]}\n\ndata: [DONE]\n\n',
    { headers: { "Content-Type": "text/event-stream" } },
  );
  const { client } = mockClient([sse]);
  const events = [];
  for await (const event of client.responses.stream({ model: "auto", input: "find", tools: [] })) events.push(event);
  assert.equal(events.length, 2);
  assert.equal(events[0]?.type, undefined);
  assert.equal((events[0] as any).choices[0].delta.tool_calls[0].function.name, "lookup");
  assert.equal((events[1] as any).choices[0].delta.content, "after");
});

test("Anthropic converts requests, tool history, tool_choice, response and usage through Chat", async () => {
  const { client, requests } = mockClient([chatResponse({ id: "msg_chat", model: "m2", content: "answer" })]);
  const response = await client.messages.create({
    model: "auto",
    max_tokens: 64,
    system: "system",
    stop_sequences: ["END"],
    messages: [
      { role: "user", content: "use lookup" },
      { role: "assistant", content: [{ type: "tool_use", id: "tu_old", name: "lookup", input: { id: "1" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "tu_old", content: "record" }] },
    ],
    tools: [{ name: "lookup", input_schema: { type: "object" } }],
    tool_choice: { type: "tool", name: "lookup" },
  });
  assert.equal(requests[0]?.url, "https://gateway.test/openai/v1/chat/completions");
  assert.equal(requests[0]?.headers.get("authorization"), "Bearer test-key");
  assert.equal(requests[0]?.headers.has("x-api-key"), false);
  assert.equal(requests[0]?.body.messages[0]?.role, "system");
  assert.equal(requests[0]?.body.messages[2]?.tool_calls[0]?.id, "tu_old");
  assert.equal(requests[0]?.body.messages[3]?.role, "tool");
  assert.deepEqual(requests[0]?.body.stop, ["END"]);
  assert.deepEqual(requests[0]?.body.tool_choice, { type: "function", function: { name: "lookup" } });
  assert.equal(response.id, "msg_chat");
  assert.equal(response.content[0]?.text, "answer");
  assert.equal(response.stop_reason, "end_turn");
  assert.deepEqual(response.usage, { input_tokens: 2, output_tokens: 3 });
});

test("Anthropic tool_use round-trip preserves opaque extra_content in both directions", async () => {
  const first = mockClient([
    chatResponse({ toolName: "lookup", arguments: '{"id":"42"}', extraContent: opaqueExtraContent }),
  ]);
  const message = await first.client.messages.create({
    model: "auto",
    max_tokens: 32,
    messages: [{ role: "user", content: "find" }],
    tools: [{ name: "lookup", input_schema: { type: "object" } }],
  });
  const toolUse = message.content.find((block) => block.type === "tool_use");
  assert.deepEqual(toolUse?.extra_content, opaqueExtraContent);

  const continuation = mockClient([chatResponse({ content: "done" })]);
  await continuation.client.messages.create({
    model: "auto",
    max_tokens: 32,
    messages: [
      { role: "assistant", content: message.content },
      { role: "user", content: [{ type: "tool_result", tool_use_id: toolUse?.id, content: "record" }] },
    ],
    tools: [{ name: "lookup", input_schema: { type: "object" } }],
  });
  assert.deepEqual(
    continuation.requests[0]?.body.messages[0]?.tool_calls[0]?.extra_content,
    opaqueExtraContent,
  );
});

test("Anthropic tool_use round-trip preserves a top-level thought_signature in both directions", async () => {
  const first = mockClient([
    chatResponse({ toolName: "lookup", arguments: '{"id":"42"}', thoughtSignature: "gemini-top-level-sig" }),
  ]);
  const message = await first.client.messages.create({
    model: "auto",
    max_tokens: 32,
    messages: [{ role: "user", content: "find" }],
    tools: [{ name: "lookup", input_schema: { type: "object" } }],
  });
  const toolUse = message.content.find((block) => block.type === "tool_use");
  assert.equal(toolUse?.thought_signature, "gemini-top-level-sig");

  const continuation = mockClient([chatResponse({ content: "done" })]);
  await continuation.client.messages.create({
    model: "auto",
    max_tokens: 32,
    messages: [
      { role: "assistant", content: message.content },
      { role: "user", content: [{ type: "tool_result", tool_use_id: toolUse?.id, content: "record" }] },
    ],
    tools: [{ name: "lookup", input_schema: { type: "object" } }],
  });
  assert.equal(
    continuation.requests[0]?.body.messages[0]?.tool_calls[0]?.thought_signature,
    "gemini-top-level-sig",
  );
});

test("Anthropic tool_use without a thought_signature does not synthesize an empty field", async () => {
  const messages = mockClient([chatResponse({ toolName: "echo" })]);
  const response = await messages.client.messages.create({
    model: "auto",
    max_tokens: 32,
    messages: [],
    tools: [{ name: "echo", input_schema: { type: "object" } }],
  });
  const toolUse = response.content.find((block) => block.type === "tool_use")!;
  assert.equal("thought_signature" in toolUse, false);
});

test("Anthropic run executes once and replays opaque tool_use metadata on the Chat continuation", async () => {
  let executions = 0;
  let executionExtraContent: unknown;
  const lookup = defineTool({
    name: "lookup",
    execute: (_input, context) => {
      executions += 1;
      executionExtraContent = context.toolCall.extra_content;
      return "record";
    },
  });
  const { client, requests } = mockClient([
    chatResponse({ toolName: "lookup", arguments: '{"id":42}', extraContent: opaqueExtraContent }),
    chatResponse({ id: "anthropic-final", content: "record" }),
  ], { tools: [lookup] });

  await client.messages.run({
    model: "auto",
    max_tokens: 32,
    messages: [{ role: "user", content: "find" }],
  });

  assert.equal(requests.length, 2);
  assert.equal(executions, 1);
  assert.deepEqual(executionExtraContent, opaqueExtraContent);
  assert.deepEqual(requests[1]?.body.messages.at(-2)?.tool_calls[0]?.extra_content, opaqueExtraContent);
  assert.deepEqual(requests[1]?.body.tools, requests[0]?.body.tools);
  assert.equal(requests[1]?.body.tools.length, 1);
});

test("Anthropic run identifies a failed tool continuation without changing tool execution", async () => {
  let executions = 0;
  const lookup = defineTool({ name: "lookup", execute: () => { executions += 1; return "record"; } });
  const failure = new Response(JSON.stringify({ error: { message: "provider continuation failed" } }), {
    status: 503,
    headers: { "Content-Type": "application/json", "x-request-id": "req_messages_continuation" },
  });
  const { client, requests } = mockClient([
    chatResponse({ toolName: "lookup", extraContent: opaqueExtraContent }),
    failure,
  ], { tools: [lookup] });

  await assert.rejects(
    () => client.messages.run({ model: "auto", max_tokens: 32, messages: [] }),
    (error: unknown) => {
      assert.ok(error instanceof JoyTokenAPIError);
      assert.equal(error.requestId, "req_messages_continuation");
      assert.deepEqual(error.context, {
        protocol: "messages",
        phase: "tool_continuation",
        requestNumber: 2,
        toolStep: 1,
        toolCalls: [{ id: "call_1", name: "lookup", hasExtraContent: true, hasThoughtSignature: false }],
      });
      return true;
    },
  );

  assert.equal(requests.length, 2);
  assert.equal(executions, 1);
  assert.deepEqual(requests[1]?.body.tools, requests[0]?.body.tools);
});

test("Anthropic marks Gateway usage as unavailable instead of returning missing token fields", async () => {
  const withoutUsage = chatResponse({ id: "msg_without_usage", content: "answer" });
  delete withoutUsage.usage;
  const { client } = mockClient([withoutUsage]);

  const response = await client.messages.create({
    model: "auto",
    max_tokens: 64,
    messages: [{ role: "user", content: "hello" }],
    tools: [],
  });

  assert.deepEqual(response.usage, { input_tokens: 0, output_tokens: 0 });
  assert.deepEqual(response.metadata?.joytoken, {
    usage_status: "unavailable",
    usage_source: "gateway",
  });
});

test("Anthropic request tools remain primitive and Client handlers execute only through run", async () => {
  let executions = 0;
  const tool = defineTool({ name: "lookup", execute: () => { executions += 1; return "record"; } });
  const primitive = mockClient([chatResponse({ toolName: "lookup", arguments: '{"id":1}' })], { tools: [tool] });
  const first = await primitive.client.messages.create({
    model: "auto",
    max_tokens: 64,
    messages: [{ role: "user", content: "find" }],
    tools: [{ name: "lookup", input_schema: { type: "object" } }],
  });
  assert.equal(primitive.requests.length, 1);
  assert.deepEqual(primitive.requests[0]?.body.tools.map((item: ChatTool) => item.function.name), ["lookup"]);
  assert.equal(executions, 0);
  assert.equal(first.stop_reason, "tool_use");
  assert.equal(first.content[0]?.type, "tool_use");

  const runner = mockClient([
    chatResponse({ id: "a1", toolName: "lookup" }),
    chatResponse({ id: "a2", content: "record" }),
  ], { tools: [tool] });
  const final = await runner.client.messages.run({
    model: "auto",
    max_tokens: 64,
    messages: [{ role: "user", content: "find" }],
    tool_choice: { type: "auto" },
    store: false,
    metadata: { source: "anthropic-run" },
  });
  assert.equal(runner.requests.length, 2);
  assert.deepEqual(runner.requests[0]?.body.tools.map((item: ChatTool) => item.function.name), ["lookup"]);
  assert.deepEqual(runner.requests[1]?.body.tools, runner.requests[0]?.body.tools);
  assert.equal(runner.requests[1]?.body.tools.length, 1);
  assert.equal(runner.requests[1]?.body.tool_choice, "auto");
  assert.equal(runner.requests[1]?.body.store, false);
  assert.deepEqual(runner.requests[1]?.body.metadata, { source: "anthropic-run" });
  assert.equal(executions, 1);
  assert.equal(final.id, "a2");
  assert.equal(final.stop_reason, "end_turn");
});

test("same-name user declarations and handlers beat SDK defaults in Responses and Anthropic", async () => {
  let executions = 0;
  const calculator = defineTool({
    name: "calculator",
    description: "user calculator",
    execute: () => { executions += 1; return { result: "user-handler" }; },
  });

  const responseRun = mockClient([
    nativeResponse({ toolName: "calculator", arguments: '{"value":1}' }),
    nativeResponse({ text: "user response" }),
  ], { tools: [calculator] });
  await responseRun.client.responses.run({
    model: "auto",
    input: "run user calculator",
    tools: [{ type: "function", name: "calculator", description: "request declaration", parameters: { type: "object" } }],
  });
  assert.equal(executions, 1);
  assert.match(responseRun.requests[1]?.body.input.at(-1)?.output, /user-handler/);
  assert.deepEqual(responseRun.requests[0]?.body.tools, [{
    type: "function",
    name: "calculator",
    description: "request declaration",
    parameters: { type: "object" },
  }]);

  const messageRun = mockClient([
    chatResponse({ toolName: "calculator", arguments: '{"value":2}' }),
    chatResponse({ content: "user message" }),
  ], { tools: [calculator] });
  await messageRun.client.messages.run({
    model: "auto",
    max_tokens: 32,
    messages: [],
    tools: [{ name: "calculator", description: "anthropic declaration", input_schema: { type: "object" } }],
  });
  assert.equal(executions, 2);
  assert.match(messageRun.requests[1]?.body.messages.at(-1)?.content, /user-handler/);
  assert.equal(messageRun.requests[0]?.body.tools.length, 1);
  assert.equal(messageRun.requests[0]?.body.tools[0]?.function?.description, "anthropic declaration");
});

test("Anthropic run returns a structured missing-handler tool_result without default fallback", async () => {
  const current = mockClient([
    chatResponse({ toolName: "calculator", arguments: '{"value":2}' }),
    chatResponse({ id: "anth_missing", content: "missing" }),
  ]);
  await current.client.messages.run({
    model: "auto",
    max_tokens: 32,
    messages: [],
    tools: [{ name: "calculator", description: "user schema", input_schema: { type: "object" } }],
  });
  assert.equal(current.requests.length, 2);
  assert.deepEqual(current.requests[1]?.body.tools, current.requests[0]?.body.tools);
  const result = JSON.parse(current.requests[1]?.body.messages.at(-1)?.content);
  assert.equal(result.error.type, "tool_handler_not_found");
  assert.equal(result.error.tool, "calculator");
});

test("Anthropic defaults auto-run and auto/any/tool/none choices map exactly", async () => {
  const automatic = mockClient([
    chatResponse({ id: "ad1", toolName: "datetime", arguments: '{"timezone":"UTC"}' }),
    chatResponse({ id: "ad2", content: "now" }),
  ]);
  const result = await automatic.client.messages.create({
    model: "auto",
    max_tokens: 32,
    messages: [{ role: "user", content: "time" }],
  });
  assert.equal(automatic.requests.length, 2);
  assert.match(automatic.requests[1]?.body.messages.at(-1)?.content, /"timezone":"UTC"/);
  assert.equal(result.id, "ad2");

  const cases = [
    { input: { type: "auto" as const }, expected: "auto" },
    { input: { type: "any" as const }, expected: "required" },
    { input: { type: "tool" as const, name: "lookup" }, expected: { type: "function", function: { name: "lookup" } } },
    { input: { type: "none" as const }, expected: "none" },
  ];
  for (const item of cases) {
    const current = mockClient([chatResponse()]);
    await current.client.messages.create({
      model: "auto",
      max_tokens: 32,
      messages: [],
      tools: [],
      tool_choice: item.input,
    });
    assert.deepEqual(current.requests[0]?.body.tool_choice, item.expected);
  }
});

test("Anthropic stream emits the standard message lifecycle", async () => {
  const sse = new Response(
    'data: {"id":"mstream","model":"m","choices":[{"index":0,"delta":{"role":"assistant","content":"hello"},"finish_reason":"stop"}]}\n\ndata: {"id":"mstream","model":"m","choices":[],"usage":{"prompt_tokens":4,"completion_tokens":1,"total_tokens":5}}\n\ndata: [DONE]\n\n',
    { headers: { "Content-Type": "text/event-stream" } },
  );
  const { client, requests } = mockClient([sse]);
  const events = [];
  for await (const event of client.messages.stream({ model: "auto", max_tokens: 32, messages: [{ role: "user", content: "hi" }], tools: [] })) {
    events.push(event);
  }
  assert.equal(requests.length, 1);
  assert.deepEqual(events.map((event) => event.type), [
    "message_start",
    "content_block_start",
    "content_block_delta",
    "content_block_stop",
    "message_delta",
    "message_stop",
  ]);
  assert.equal(events[2]?.delta?.text, "hello");
  assert.equal(events[4]?.delta?.stop_reason, "end_turn");
  assert.equal(events[4]?.usage?.output_tokens, 1);
});

test("Anthropic stream delays message_start for metadata-only Chat events and marks missing usage", async () => {
  const sse = new Response(
    'data: {"metadata":{"request_class":"standard"}}\n\ndata: {"id":"m_metadata","model":"m","choices":[{"index":0,"delta":{"role":"assistant","content":"hello"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
    { headers: { "Content-Type": "text/event-stream" } },
  );
  const { client } = mockClient([sse]);
  const events = [];
  for await (const event of client.messages.stream({
    model: "auto",
    max_tokens: 32,
    messages: [{ role: "user", content: "hi" }],
    tools: [],
  })) events.push(event);

  assert.equal(events[0]?.type, "message_start");
  assert.equal(events[0]?.message?.id, "m_metadata");
  assert.equal(events[0]?.message?.model, "m");
  assert.deepEqual(events[0]?.message?.metadata, { request_class: "standard" });
  const delta = events.find((event) => event.type === "message_delta");
  assert.deepEqual(delta?.usage, { input_tokens: 0, output_tokens: 0 });
  assert.deepEqual(delta?.metadata, {
    request_class: "standard",
    joytoken: { usage_status: "unavailable", usage_source: "gateway" },
  });
});

test("Anthropic stream converts fragmented Chat tool calls to tool_use JSON deltas", async () => {
  const sse = new Response(
    'data: {"id":"at","model":"m","choices":[{"index":0,"delta":{"role":"assistant","tool_calls":[{"index":0,"id":"call_at","type":"function","function":{"name":"lookup","arguments":"{\\\"id\\\":"},"extra_content":{"google":{"thought_signature":"opaque-signature"},"future_vendor":{"nested":{"a":1}}}}]},"finish_reason":null}]}\n\ndata: {"id":"at","model":"m","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"7}"},"extra_content":{"google":{"second":"kept"},"future_vendor":{"nested":{"b":2}}}}]},"finish_reason":"tool_calls"}]}\n\ndata: [DONE]\n\n',
    { headers: { "Content-Type": "text/event-stream" } },
  );
  const { client } = mockClient([sse]);
  const events = [];
  for await (const event of client.messages.stream({ model: "auto", max_tokens: 32, messages: [], tools: [] })) events.push(event);
  const start = events.find((event) => event.type === "content_block_start");
  assert.equal(start?.content_block?.type, "tool_use");
  assert.equal(start?.content_block?.name, "lookup");
  assert.deepEqual(start?.content_block?.extra_content, {
    google: { thought_signature: "opaque-signature", second: "kept" },
    future_vendor: { nested: { a: 1, b: 2 } },
  });
  assert.equal(
    events.filter((event) => event.type === "content_block_delta").map((event) => event.delta?.partial_json).join(""),
    '{"id":7}',
  );
  assert.equal(events.at(-2)?.delta?.stop_reason, "tool_use");
  assert.equal(events.at(-1)?.type, "message_stop");
});

test("Anthropic stream keeps content blocks sequential and waits for fragmented tool identity", async () => {
  const sse = new Response(
    'data: {"id":"ordered","model":"m","choices":[{"index":0,"delta":{"role":"assistant","content":"before"},"finish_reason":null}]}\n\ndata: {"id":"ordered","model":"m","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_late","type":"function","function":{"arguments":"{\\"id\\":"}}]},"finish_reason":null}]}\n\ndata: {"id":"ordered","model":"m","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"name":"look","arguments":"7"}}]},"finish_reason":null}]}\n\ndata: {"id":"ordered","model":"m","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"name":"up","arguments":"}"}}],"content":"after"},"finish_reason":"tool_calls"}]}\n\ndata: [DONE]\n\n',
    { headers: { "Content-Type": "text/event-stream" } },
  );
  const { client } = mockClient([sse]);
  const events = [];
  for await (const event of client.messages.stream({ model: "auto", max_tokens: 32, messages: [], tools: [] })) events.push(event);

  assert.deepEqual(events.map((event) => event.type), [
    "message_start",
    "content_block_start",
    "content_block_delta",
    "content_block_stop",
    "content_block_start",
    "content_block_delta",
    "content_block_stop",
    "content_block_start",
    "content_block_delta",
    "content_block_stop",
    "message_delta",
    "message_stop",
  ]);
  assert.equal(events[4]?.content_block?.type, "tool_use");
  assert.equal(events[4]?.content_block?.id, "call_late");
  assert.equal(events[4]?.content_block?.name, "lookup");
  assert.equal(events[5]?.delta?.partial_json, '{"id":7}');
  assert.equal(events[8]?.delta?.text, "after");
});

test("Anthropic runStream executes the selected handler once and returns the final Chat turn metadata", async () => {
  let executions = 0;
  const tool = defineTool({
    name: "lookup",
    execute: (input) => {
      executions += 1;
      return { record: input };
    },
  });
  const first = new Response(
    'data: {"id":"anth_stream_first","model":"first-model","choices":[{"index":0,"delta":{"role":"assistant","tool_calls":[{"index":0,"id":"call_stream","type":"function","function":{"name":"lookup"},"extra_content":{"google":{"thought_signature":"opaque-signature"},"future_vendor":{"nested":{"a":1}}}}]},"finish_reason":null}]}\n\ndata: {"id":"anth_stream_first","model":"first-model","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"id\\":9}"},"extra_content":{"future_vendor":{"nested":{"b":2}}}}]},"finish_reason":"tool_calls"}]}\n\ndata: {"id":"anth_stream_first","model":"first-model","choices":[],"usage":{"prompt_tokens":2,"completion_tokens":1,"total_tokens":3}}\n\ndata: [DONE]\n\n',
    { headers: { "Content-Type": "text/event-stream" } },
  );
  const final = new Response(
    'data: {"id":"anth_stream_final","model":"final-model","choices":[{"index":0,"delta":{"role":"assistant","content":"found"},"finish_reason":"stop"}]}\n\ndata: {"id":"anth_stream_final","model":"final-model","choices":[],"usage":{"prompt_tokens":8,"completion_tokens":2,"total_tokens":10}}\n\ndata: [DONE]\n\n',
    { headers: { "Content-Type": "text/event-stream" } },
  );
  const { client, requests } = mockClient([first, final], { tools: [tool] });
  const text: string[] = [];
  const toolResults: string[] = [];

  assert.equal(typeof client.messages.executeToolsStream, "function");
  const response = await client.messages.runStream(
    { model: "auto", max_tokens: 32, messages: [{ role: "user", content: "find" }] },
    {
      onTextDelta: (delta) => text.push(delta),
      onToolResult: (result) => toolResults.push(result.content),
    },
  );

  assert.equal(requests.length, 2);
  assert.ok(requests.every((request) => request.url === "https://gateway.test/openai/v1/chat/completions"));
  assert.ok(requests.every((request) => request.body.stream === true));
  assert.deepEqual(requests[0]?.body.tools.map((item: ChatTool) => item.function.name), ["lookup"]);
  assert.deepEqual(requests[1]?.body.tools, requests[0]?.body.tools);
  assert.equal(requests[1]?.body.messages.at(-1)?.role, "tool");
  assert.equal(requests[1]?.body.messages.at(-1)?.tool_call_id, "call_stream");
  assert.deepEqual(requests[1]?.body.messages.at(-2)?.tool_calls[0]?.extra_content, {
    google: { thought_signature: "opaque-signature" },
    future_vendor: { nested: { a: 1, b: 2 } },
  });
  assert.equal(executions, 1);
  assert.equal(toolResults.length, 1);
  assert.match(toolResults[0] ?? "", /"id":9/);
  assert.deepEqual(text, ["found"]);
  assert.equal(response.id, "anth_stream_final");
  assert.equal(response.model, "final-model");
  assert.equal(response.stop_reason, "end_turn");
  assert.deepEqual(response.usage, { input_tokens: 8, output_tokens: 2 });
});

test("Anthropic runStream reports continuation context and executes the tool once", async () => {
  let executions = 0;
  const first = new Response(
    'data: {"id":"anthropic-error","model":"m","choices":[{"index":0,"delta":{"role":"assistant","tool_calls":[{"index":0,"id":"call_anthropic_error","type":"function","function":{"name":"lookup","arguments":"{}"}}]},"finish_reason":"tool_calls"}]}\n\ndata: [DONE]\n\n',
    { headers: { "Content-Type": "text/event-stream" } },
  );
  const failure = new Response(JSON.stringify({ error: { message: "continuation failed" } }), {
    status: 400,
    headers: { "Content-Type": "application/json" },
  });
  const lookup = defineTool({ name: "lookup", execute: () => { executions += 1; return "record"; } });
  const { client, requests } = mockClient([first, failure], { tools: [lookup] });

  await assert.rejects(
    () => client.messages.runStream({ model: "auto", max_tokens: 32, messages: [] }),
    (error: unknown) => {
      assert.ok(error instanceof JoyTokenAPIError);
      assert.deepEqual(error.context, {
        protocol: "messages",
        phase: "tool_continuation",
        requestNumber: 2,
        toolStep: 1,
        toolCalls: [{ id: "call_anthropic_error", name: "lookup", hasExtraContent: false, hasThoughtSignature: false }],
      });
      return true;
    },
  );

  assert.equal(requests.length, 2);
  assert.equal(executions, 1);
});

test("Base URL variants derive exactly one Chat Completions endpoint", async () => {
  const variants = [
    { apiBaseUrl: "https://gateway.test" },
    { apiBaseUrl: "https://gateway.test/" },
    { apiBaseUrl: "https://gateway.test/openai/v1" },
    { apiBaseUrl: "https://gateway.test/openai/v1/" },
    { apiBaseUrl: "https://gateway.test/openai/v1/chat/completions/" },
    { apiBaseUrl: "https://ignored.test", openAIBaseUrl: "https://gateway.test/openai/v1/responses" },
    { anthropicBaseUrl: "https://gateway.test/anthropic/v1/messages" },
  ];
  for (const variant of variants) {
    const { client, requests } = mockClient([chatResponse()], variant);
    await client.chat.completions.create({ model: "auto", messages: [], tools: [] });
    assert.equal(requests[0]?.url, "https://gateway.test/openai/v1/chat/completions");
  }
});

test("Gateway 503 remains an SDK error and is never converted into protocol success", async () => {
  const failure = new Response(JSON.stringify({ error: { message: "provider invoke failed" } }), {
    status: 503,
    headers: { "Content-Type": "application/json", "x-request-id": "req_503" },
  });
  const { client, requests } = mockClient([failure], { maxRetries: 0 });
  await assert.rejects(
    () => client.responses.create({ model: "auto", input: "probe", tools: [] }),
    (error: unknown) => {
      assert.ok(error instanceof JoyTokenAPIError);
      assert.equal(error.status, 503);
      assert.equal(error.code, "server_error");
      assert.equal(error.requestId, "req_503");
      assert.deepEqual(error.body, { error: { message: "provider invoke failed" } });
      return true;
    },
  );
  assert.equal(requests.length, 1);
});

test("all local default tools execute inside a temporary workspace and side effects remain permission-gated", async (t) => {
  const workspace = await mkdtemp(join(tmpdir(), "joytoken-default-tools-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  await writeFile(join(workspace, "note.txt"), "sandbox note", "utf8");

  const cases = [
    { name: "calculator", args: { expression: "5.5 % 2" }, expected: /1\.5/ },
    { name: "datetime", args: { timezone: "UTC" }, expected: /"timezone":"UTC"/ },
    { name: "file_read", args: { path: "note.txt" }, expected: /sandbox note/ },
    { name: "list_dir", args: { path: "." }, expected: /note\.txt/ },
    { name: "file_search", args: { pattern: "*.txt" }, expected: /note\.txt/ },
    { name: "file_write", args: { path: "written.txt", content: "approved" }, expected: /written\.txt/ },
    { name: "shell", args: { command: "printf joytoken-safe" }, expected: /joytoken-safe/ },
  ];

  let fileApprovals = 0;
  let shellApprovals = 0;
  for (const item of cases) {
    const current = mockClient(
      [
        chatResponse({ toolName: item.name, arguments: JSON.stringify(item.args) }),
        chatResponse({ content: "done" }),
      ],
      {
        fileWorkspace: workspace,
        shellWorkspace: workspace,
        filePermission: () => { fileApprovals += 1; return true; },
        shellPermission: () => { shellApprovals += 1; return true; },
      },
    );
    await current.client.chat.completions.create({ model: "auto", messages: [{ role: "user", content: item.name }] });
    assert.equal(current.requests.length, 2, `${item.name} should make exactly two HTTP requests`);
    assert.match(current.requests[1]?.body.messages.at(-1)?.content, item.expected);
  }
  assert.equal(fileApprovals, 1);
  assert.equal(shellApprovals, 1);
  assert.equal(await readFile(join(workspace, "written.txt"), "utf8"), "approved");

  const deniedWrite = mockClient([
    chatResponse({ toolName: "file_write", arguments: '{"path":"denied.txt","content":"no"}' }),
    chatResponse({ content: "denied" }),
  ], { fileWorkspace: workspace });
  await deniedWrite.client.chat.completions.create({ model: "auto", messages: [] });
  assert.match(deniedWrite.requests[1]?.body.messages.at(-1)?.content, /no file permission handler configured/);
  await assert.rejects(() => readFile(join(workspace, "denied.txt"), "utf8"), /ENOENT/);

  const deniedShell = mockClient([
    chatResponse({ toolName: "shell", arguments: '{"command":"printf should-not-run"}' }),
    chatResponse({ content: "denied" }),
  ], { shellWorkspace: workspace });
  await deniedShell.client.chat.completions.create({ model: "auto", messages: [] });
  assert.match(deniedShell.requests[1]?.body.messages.at(-1)?.content, /no shell permission handler configured/);
});

function orchestratedStream(): Response {
  const chunks = [
    // Plan announcement (no content yet).
    '{"id":"orc1","model":"m","orchestration":{"phase":"plan","plan":[{"seq":1,"task_id":"search","title":"Search"},{"seq":2,"task_id":"__final__","title":"Answer"}]},"choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}',
    // Search stage emits intermediate content that must NOT leak into the reply.
    '{"id":"orc1","model":"m","orchestration":{"task_id":"search","task_seq":1,"task_status":"RUNNING","title":"Search"},"choices":[{"index":0,"delta":{"content":"searching..."},"finish_reason":null}]}',
    '{"id":"orc1","model":"m","orchestration":{"task_id":"search","task_seq":1,"task_status":"DONE","title":"Search"},"choices":[{"index":0,"delta":{},"finish_reason":null}]}',
    // Final stage content feeds the user-facing reply.
    '{"id":"orc1","model":"m","orchestration":{"task_id":"__final__","task_seq":2,"task_status":"RUNNING","title":"Answer"},"choices":[{"index":0,"delta":{"content":"final "},"finish_reason":null}]}',
    '{"id":"orc1","model":"m","orchestration":{"task_id":"__final__","task_seq":2,"task_status":"DONE","title":"Answer"},"choices":[{"index":0,"delta":{"content":"answer"},"finish_reason":"stop"}]}',
  ];
  const body = chunks.map((chunk) => `data: ${chunk}\n\n`).join("") + "data: [DONE]\n\n";
  return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
}

test("Chat runStream keeps only the final orchestration stage in the reply", async () => {
  const { client } = mockClient([orchestratedStream()]);
  const deltas: string[] = [];
  const events: any[] = [];
  const response = await client.chat.completions.runStream(
    { model: "auto", messages: [] },
    { onTextDelta: (delta) => deltas.push(delta), onOrchestrationEvent: (event) => events.push(event) },
  );
  // Only the final-answer stage text reaches the user-facing reply.
  assert.equal(response.choices[0]?.message.content, "final answer");
  assert.deepEqual(deltas, ["final ", "answer"]);
  // Orchestration summary carries the plan plus every sub-task stage.
  assert.deepEqual(response.orchestration?.plan?.map((item) => item.task_id), ["search", "__final__"]);
  assert.deepEqual(response.orchestration?.stages.map((stage) => stage.task_id), ["search", "__final__"]);
  const searchStage = response.orchestration?.stages.find((stage) => stage.task_id === "search");
  const finalStage = response.orchestration?.stages.find((stage) => stage.task_id === "__final__");
  assert.equal(searchStage?.content, "searching...");
  assert.equal(searchStage?.task_status, "DONE");
  assert.equal(finalStage?.content, "final answer");
  // Progress callbacks expose the plan then each stage transition.
  const planEvents = events.filter((event) => event.type === "plan");
  const stageEvents = events.filter((event) => event.type === "stage");
  assert.equal(planEvents.length, 1);
  assert.equal(planEvents[0].plan.length, 2);
  assert.ok(stageEvents.some((event) => event.task_id === "search" && event.final === false));
  assert.ok(stageEvents.some((event) => event.task_id === "__final__" && event.final === true));
  assert.ok(stageEvents.some((event) => event.task_id === "search" && event.task_status === "DONE"));
});

test("Chat runStream falls back to all stages when no final stage is emitted", async () => {
  const body = [
    'data: {"id":"orc2","model":"m","orchestration":{"task_id":"search","task_seq":1,"task_status":"RUNNING"},"choices":[{"index":0,"delta":{"content":"partial "},"finish_reason":null}]}\n\n',
    'data: {"id":"orc2","model":"m","orchestration":{"task_id":"plan","task_seq":2,"task_status":"RUNNING"},"choices":[{"index":0,"delta":{"content":"answer"},"finish_reason":"stop"}]}\n\n',
    "data: [DONE]\n\n",
  ].join("");
  const { client } = mockClient([new Response(body, { headers: { "Content-Type": "text/event-stream" } })]);
  const response = await client.chat.completions.runStream({ model: "auto", messages: [] });
  // No __final__ stage: concatenate every stage so nothing is silently dropped.
  assert.equal(response.choices[0]?.message.content, "partial answer");
  assert.equal(response.orchestration?.stages.length, 2);
});

test("Chat runStream leaves non-orchestrated turns unchanged", async () => {
  const body = [
    'data: {"id":"plain1","model":"m","choices":[{"index":0,"delta":{"role":"assistant","content":"hello "},"finish_reason":null}]}\n\n',
    'data: {"id":"plain1","model":"m","choices":[{"index":0,"delta":{"content":"world"},"finish_reason":"stop"}]}\n\n',
    "data: [DONE]\n\n",
  ].join("");
  const { client } = mockClient([new Response(body, { headers: { "Content-Type": "text/event-stream" } })]);
  const deltas: string[] = [];
  const events: any[] = [];
  const response = await client.chat.completions.runStream(
    { model: "auto", messages: [] },
    { onTextDelta: (delta) => deltas.push(delta), onOrchestrationEvent: (event) => events.push(event) },
  );
  assert.equal(response.choices[0]?.message.content, "hello world");
  assert.deepEqual(deltas, ["hello ", "world"]);
  // Without orchestration metadata the summary and progress callbacks stay absent.
  assert.equal(response.orchestration, undefined);
  assert.equal(events.length, 0);
});

test("Chat stream surfaces a mid-stream error event instead of yielding an empty chunk", async () => {
  // The Gateway reports an orchestration failure as an error envelope with empty choices.
  const body = [
    'data: {"id":"err1","model":"m","choices":[{"index":0,"delta":{"role":"assistant","content":"partial"},"finish_reason":null}]}\n\n',
    'data: {"error":{"message":"orchestration run failed: STORE_ERROR","type":"orchestration_error"},"choices":[]}\n\n',
    "data: [DONE]\n\n",
  ].join("");
  const { client } = mockClient([new Response(body, { headers: { "Content-Type": "text/event-stream" } })]);
  await assert.rejects(
    async () => {
      for await (const _chunk of client.chat.completions.stream({ model: "auto", messages: [] })) {
        // Drain the stream; the error event must throw before completion.
      }
    },
    (error: unknown) => {
      assert.ok(error instanceof JoyTokenAPIError);
      assert.match(error.message, /orchestration run failed: STORE_ERROR/);
      assert.deepEqual((error.body as { type?: string }).type, "orchestration_error");
      return true;
    },
  );
});

test("Chat runStream rejects when the orchestration stream returns an error event", async () => {
  const body = [
    'data: {"id":"err2","model":"m","orchestration":{"phase":"plan","plan":[]},"choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}\n\n',
    'data: {"error":{"message":"orchestration_error: context deadline exceeded"},"choices":[]}\n\n',
    "data: [DONE]\n\n",
  ].join("");
  const { client } = mockClient([new Response(body, { headers: { "Content-Type": "text/event-stream" } })]);
  await assert.rejects(
    () => client.chat.completions.runStream({ model: "auto", messages: [] }),
    (error: unknown) => {
      assert.ok(error instanceof JoyTokenAPIError);
      assert.match(error.message, /context deadline exceeded/);
      return true;
    },
  );
});

test("Chat non-streaming create rejects when the JSON body carries an error envelope", async () => {
  // A non-streaming orchestration failure arrives as HTTP 200 with an error envelope and empty choices.
  const body = JSON.stringify({
    error: { message: "orchestration run failed: STORE_ERROR", type: "orchestration_error" },
    choices: [],
  });
  const { client } = mockClient([new Response(body, { headers: { "Content-Type": "application/json" } })]);
  await assert.rejects(
    () => client.chat.completions.create({ model: "auto", messages: [] }),
    (error: unknown) => {
      assert.ok(error instanceof JoyTokenAPIError);
      assert.match(error.message, /orchestration run failed: STORE_ERROR/);
      assert.deepEqual((error.body as { type?: string }).type, "orchestration_error");
      return true;
    },
  );
});
