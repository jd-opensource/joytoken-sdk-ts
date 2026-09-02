import assert from "node:assert/strict";
import { test } from "node:test";
import {
  JoyTokenAPIError,
  JoyTokenClient,
  defineTool,
  type Response as JoyTokenResponse,
  type ResponseOutputItem,
} from "../src/index.js";

interface CapturedRequest {
  url: string;
  body: Record<string, any>;
}

function response(options: {
  id?: string;
  model?: string;
  text?: string;
  toolName?: string;
  callId?: string;
  arguments?: string;
  extraContent?: Record<string, unknown>;
  output?: ResponseOutputItem[];
} = {}): JoyTokenResponse {
  const output = options.output ?? (options.toolName
    ? [{
        id: `fc_${options.callId ?? "call_1"}`,
        type: "function_call",
        status: "completed",
        call_id: options.callId ?? "call_1",
        name: options.toolName,
        arguments: options.arguments ?? "{}",
        ...(options.extraContent === undefined ? {} : { extra_content: options.extraContent }),
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
    status: "completed",
    model: options.model ?? "auto",
    output,
    usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 },
    metadata: { routed: true },
  };
}

const opaqueExtraContent = {
  google: { thought_signature: "opaque-signature", provider_flag: "keep-me" },
  future_vendor: { nested: { token: "vendor-token" }, values: [1, 2, 3] },
};

function mockClient(
  replies: Array<JoyTokenResponse | Response>,
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
      requests.push({ url: String(input), body: JSON.parse(String(init?.body ?? "{}")) });
      const reply = replies[Math.min(index++, replies.length - 1)]!;
      return reply instanceof Response ? reply : Response.json(reply);
    },
  });
  return { client, requests };
}

test("native Responses preserves all protocol fields and output item variants", async () => {
  const output: ResponseOutputItem[] = [
    { id: "rs_1", type: "reasoning", status: "completed", summary: [{ type: "summary_text", text: "thought" }], encrypted_content: "cipher" },
    { id: "ws_1", type: "web_search_call", status: "completed", action: { type: "search", query: "JoyToken" } },
    { id: "fs_1", type: "file_search_call", status: "completed", results: [{ file_id: "file_1" }] },
    { id: "msg_1", type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "answer", annotations: [{ type: "url_citation" }] }] },
  ];
  const { client, requests } = mockClient([response({ id: "native", output })]);
  const tool = { type: "function" as const, name: "lookup", description: "Lookup", parameters: { type: "object" }, strict: true };
  const result = await client.responses.create({
    model: "auto",
    input: "hello",
    instructions: "be concise",
    max_output_tokens: 64,
    temperature: 0.2,
    top_p: 0.9,
    tools: [tool],
    tool_choice: { type: "function", name: "lookup" },
    parallel_tool_calls: true,
    previous_response_id: "previous",
    include: ["reasoning.encrypted_content"],
    store: false,
    service_tier: "default",
    metadata: { source: "native-test" },
  });
  assert.equal(requests[0]?.url, "https://gateway.test/openai/v1/responses");
  assert.deepEqual(requests[0]?.body.tools, [tool]);
  assert.deepEqual(requests[0]?.body.tool_choice, { type: "function", name: "lookup" });
  assert.equal(requests[0]?.body.parallel_tool_calls, true);
  assert.equal(requests[0]?.body.previous_response_id, "previous");
  assert.deepEqual(requests[0]?.body.include, ["reasoning.encrypted_content"]);
  assert.equal(requests[0]?.body.store, false);
  assert.equal(requests[0]?.body.service_tier, "default");
  assert.equal("messages" in requests[0]!.body, false);
  assert.deepEqual(result.output, output);
  assert.equal(result.output_text, "answer");
});

test("native Responses run keeps effectiveTools and request options on every turn", async () => {
  let executions = 0;
  const echo = defineTool({ name: "echo", execute: (input) => { executions += 1; return { echoed: input }; } });
  const { client, requests } = mockClient([
    response({ id: "first", toolName: "echo", arguments: '{"text":"hi"}' }),
    response({ id: "final", model: "last", text: "done" }),
  ], { tools: [echo] });
  const result = await client.responses.run({
    model: "auto",
    input: "echo",
    tool_choice: "auto",
    parallel_tool_calls: true,
    store: false,
    temperature: 0.1,
    metadata: { source: "run" },
  });
  assert.equal(requests.length, 2);
  assert.equal(executions, 1);
  assert.deepEqual(requests[1]?.body.tools, requests[0]?.body.tools);
  assert.equal(requests[1]?.body.tools.length, 1);
  assert.equal(requests[1]?.body.tools[0]?.name, "echo");
  assert.equal(requests[1]?.body.tool_choice, "auto");
  assert.equal(requests[1]?.body.parallel_tool_calls, true);
  assert.equal(requests[1]?.body.store, false);
  assert.equal(requests[1]?.body.temperature, 0.1);
  assert.deepEqual(requests[1]?.body.metadata, { source: "run" });
  assert.equal(requests[1]?.body.input.at(-2)?.type, "function_call");
  assert.equal(requests[1]?.body.input.at(-1)?.type, "function_call_output");
  assert.equal(requests[1]?.body.input.at(-1)?.call_id, "call_1");
  assert.match(requests[1]?.body.input.at(-1)?.output, /"text":"hi"/);
  assert.equal(result.id, "final");
  assert.equal(result.model, "last");
  assert.equal(result.output_text, "done");
});

test("native Responses run preserves opaque function_call metadata in replay and execution context", async () => {
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
    response({ toolName: "echo", arguments: '{"text":"hello"}', extraContent: opaqueExtraContent }),
    response({ id: "final-extra", text: "done" }),
  ], { tools: [echo] });

  await client.responses.run({ model: "auto", input: "echo" });

  assert.equal(requests.length, 2);
  assert.equal(executions, 1);
  assert.deepEqual(executionExtraContent, opaqueExtraContent);
  assert.deepEqual(requests[1]?.body.input.at(-2)?.extra_content, opaqueExtraContent);
  assert.equal(requests[1]?.body.tools.length, 1);
  assert.deepEqual(requests[1]?.body.tools, requests[0]?.body.tools);
});

test("native Responses run reports the failed continuation without retrying the tool", async () => {
  let executions = 0;
  const echo = defineTool({ name: "echo", execute: () => { executions += 1; return "echoed"; } });
  const failureBody = { error: { code: "provider_error", message: "continuation rejected" } };
  const failure = new Response(JSON.stringify(failureBody), {
    status: 503,
    headers: { "Content-Type": "application/json", "x-request-id": "req_responses_continuation" },
  });
  const { client, requests } = mockClient([
    response({ toolName: "echo", extraContent: opaqueExtraContent }),
    failure,
  ], { tools: [echo] });

  await assert.rejects(
    () => client.responses.run({ model: "auto", input: "echo" }),
    (error: unknown) => {
      assert.ok(error instanceof JoyTokenAPIError);
      assert.equal(error.status, 503);
      assert.equal(error.requestId, "req_responses_continuation");
      assert.deepEqual(error.body, failureBody);
      assert.deepEqual(error.context, {
        protocol: "responses",
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

test("native Responses calls without extra_content do not emit an empty extension object", async () => {
  const echo = defineTool({ name: "echo", execute: () => "echoed" });
  const { client, requests } = mockClient([
    response({ toolName: "echo" }),
    response({ text: "done" }),
  ], { tools: [echo] });

  await client.responses.run({ model: "auto", input: "echo" });

  const replayedCall = requests[1]?.body.input.at(-2);
  assert.equal("extra_content" in replayedCall, false);
});

test("native Responses previous_response_id continuation avoids history replay", async () => {
  const echo = defineTool({ name: "echo", execute: () => "echoed" });
  const { client, requests } = mockClient([
    response({ id: "first", toolName: "echo", callId: "call_prev" }),
    response({ id: "final", text: "done" }),
  ], { tools: [echo] });
  await client.responses.run({ model: "auto", input: "continue", previous_response_id: "older" });
  assert.equal(requests[0]?.body.previous_response_id, "older");
  assert.equal(requests[1]?.body.previous_response_id, "first");
  assert.equal(requests[1]?.body.input.length, 1);
  assert.equal(requests[1]?.body.input[0]?.type, "function_call_output");
  assert.equal(requests[1]?.body.input[0]?.call_id, "call_prev");
});

test("native Responses run emits structured missing-handler output without default fallback", async () => {
  const calculator = { type: "function" as const, name: "calculator", parameters: { type: "object" } };
  const { client, requests } = mockClient([
    response({ toolName: "calculator", arguments: '{"value":1}' }),
    response({ id: "final", text: "missing" }),
  ]);
  await client.responses.run({ model: "auto", input: "calculate", tools: [calculator] });
  const output = JSON.parse(requests[1]?.body.input.at(-1)?.output);
  assert.deepEqual(requests[1]?.body.tools, [calculator]);
  assert.equal(output.error.type, "tool_handler_not_found");
  assert.equal(output.error.tool, "calculator");
});

test("native Responses runStream aggregates terminal responses and reports text/tool callbacks", async () => {
  const first = response({ id: "first", toolName: "echo", arguments: '{"text":"hi"}' });
  const final = response({ id: "final", text: "done" });
  const firstSSE = new Response(
    `data: {"type":"response.output_item.done","sequence_number":0,"output_index":0,"item":${JSON.stringify(first.output?.[0])}}\n\ndata: {"type":"response.completed","sequence_number":1,"response":${JSON.stringify(first)}}\n\ndata: [DONE]\n\n`,
    { headers: { "Content-Type": "text/event-stream" } },
  );
  const finalSSE = new Response(
    `data: {"type":"response.output_text.delta","sequence_number":0,"delta":"done"}\n\ndata: {"type":"response.completed","sequence_number":1,"response":${JSON.stringify(final)}}\n\ndata: [DONE]\n\n`,
    { headers: { "Content-Type": "text/event-stream" } },
  );
  const echo = defineTool({ name: "echo", execute: () => "echoed" });
  const { client, requests } = mockClient([firstSSE, finalSSE], { tools: [echo] });
  const deltas: string[] = [];
  const results: string[] = [];
  const result = await client.responses.runStream(
    { model: "auto", input: "echo", parallel_tool_calls: false },
    { onTextDelta: (delta) => deltas.push(delta), onToolResult: (toolResult) => results.push(toolResult.content) },
  );
  assert.equal(requests.length, 2);
  assert.ok(requests.every((request) => request.url === "https://gateway.test/openai/v1/responses" && request.body.stream === true));
  assert.deepEqual(requests[1]?.body.tools, requests[0]?.body.tools);
  assert.equal(requests[1]?.body.parallel_tool_calls, false);
  assert.equal(requests[1]?.body.input.at(-1)?.type, "function_call_output");
  assert.deepEqual(deltas, ["done"]);
  assert.deepEqual(results, ["echoed"]);
  assert.equal(result.id, "final");
  assert.equal(result.output_text, "done");
});

test("native Responses runStream keeps output_item.done opaque metadata on the continuation", async () => {
  let executions = 0;
  let executionExtraContent: unknown;
  const first = response({ toolName: "echo", arguments: '{"text":"hi"}', extraContent: opaqueExtraContent });
  const terminalWithoutOutput = { ...first, output: [] };
  const final = response({ id: "stream-final-extra", text: "done" });
  const firstSSE = new Response(
    `data: {"type":"response.output_item.done","sequence_number":0,"output_index":0,"item":${JSON.stringify(first.output?.[0])}}\n\ndata: {"type":"response.completed","sequence_number":1,"response":${JSON.stringify(terminalWithoutOutput)}}\n\ndata: [DONE]\n\n`,
    { headers: { "Content-Type": "text/event-stream" } },
  );
  const finalSSE = new Response(
    `data: {"type":"response.completed","sequence_number":0,"response":${JSON.stringify(final)}}\n\ndata: [DONE]\n\n`,
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
  const { client, requests } = mockClient([firstSSE, finalSSE], { tools: [echo] });

  await client.responses.runStream({ model: "auto", input: "echo" });

  assert.equal(requests.length, 2);
  assert.equal(executions, 1);
  assert.deepEqual(executionExtraContent, opaqueExtraContent);
  assert.deepEqual(requests[1]?.body.input.at(-2)?.extra_content, opaqueExtraContent);
  assert.deepEqual(requests[1]?.body.tools, requests[0]?.body.tools);
});

test("native Responses runStream annotates a failed continuation and executes once", async () => {
  let executions = 0;
  const first = response({ toolName: "echo", callId: "call_stream_error" });
  const firstSSE = new Response(
    `data: {"type":"response.output_item.done","sequence_number":0,"output_index":0,"item":${JSON.stringify(first.output?.[0])}}\n\ndata: {"type":"response.completed","sequence_number":1,"response":${JSON.stringify(first)}}\n\ndata: [DONE]\n\n`,
    { headers: { "Content-Type": "text/event-stream" } },
  );
  const failure = new Response(JSON.stringify({ error: { message: "continuation rejected" } }), {
    status: 400,
    headers: { "Content-Type": "application/json" },
  });
  const echo = defineTool({ name: "echo", execute: () => { executions += 1; return "echoed"; } });
  const { client, requests } = mockClient([firstSSE, failure], { tools: [echo] });

  await assert.rejects(
    () => client.responses.runStream({ model: "auto", input: "echo" }),
    (error: unknown) => {
      assert.ok(error instanceof JoyTokenAPIError);
      assert.deepEqual(error.context, {
        protocol: "responses",
        phase: "tool_continuation",
        requestNumber: 2,
        toolStep: 1,
        toolCalls: [{ id: "call_stream_error", name: "echo", hasExtraContent: false, hasThoughtSignature: false }],
      });
      return true;
    },
  );

  assert.equal(requests.length, 2);
  assert.equal(executions, 1);
});

test("native Responses run always submits executed outputs before exhausting toolMaxSteps", async () => {
  let executions = 0;
  const echo = defineTool({ name: "echo", execute: () => { executions += 1; return "echoed"; } });
  const { client, requests } = mockClient([
    response({ id: "tool-turn", toolName: "echo" }),
    response({ id: "final-turn", model: "final-model", text: "finished" }),
  ], { tools: [echo], toolMaxSteps: 1 });

  const result = await client.responses.run({ model: "auto", input: "echo" });

  assert.equal(executions, 1);
  assert.equal(requests.length, 2);
  assert.equal(requests[1]?.body.input.at(-1)?.type, "function_call_output");
  assert.equal(result.id, "final-turn");
  assert.equal(result.model, "final-model");
  assert.equal(result.output_text, "finished");
});

test("native Responses runStream requires an explicit terminal event and preserves failed status", async () => {
  const failed: JoyTokenResponse = {
    id: "failed-response",
    object: "response",
    status: "failed",
    model: "failed-model",
    output: [],
    usage: { input_tokens: 4, output_tokens: 0, total_tokens: 4 },
    error: { code: "provider_error", message: "provider invoke failed" },
    metadata: { turn: "failed" },
  };
  const failedSSE = new Response(
    `data: {"type":"response.failed","sequence_number":0,"response":${JSON.stringify(failed)}}\n\ndata: [DONE]\n\n`,
    { headers: { "Content-Type": "text/event-stream" } },
  );
  const failedClient = mockClient([failedSSE]);
  const result = await failedClient.client.responses.runStream({ model: "auto", input: "fail", tools: [] });
  assert.equal(result.status, "failed");
  assert.equal(result.id, "failed-response");
  assert.deepEqual(result.error, failed.error);
  assert.deepEqual(result.usage, failed.usage);
  assert.deepEqual(result.metadata, failed.metadata);

  const createdOnly = new Response(
    'data: {"type":"response.created","sequence_number":0,"response":{"id":"partial","object":"response","status":"in_progress","model":"auto","output":[]}}\n\ndata: [DONE]\n\n',
    { headers: { "Content-Type": "text/event-stream" } },
  );
  const truncatedClient = mockClient([createdOnly]);
  await assert.rejects(
    () => truncatedClient.client.responses.runStream({ model: "auto", input: "truncated", tools: [] }),
    /ended without a terminal response event/,
  );

  const errorEvent = new Response(
    'data: {"type":"error","sequence_number":0,"error":{"code":"stream_error","message":"broken"}}\n\ndata: [DONE]\n\n',
    { headers: { "Content-Type": "text/event-stream" } },
  );
  const errorClient = mockClient([errorEvent]);
  await assert.rejects(
    () => errorClient.client.responses.runStream({ model: "auto", input: "error", tools: [] }),
    /Responses stream error.*stream_error/,
  );
});

test("native Responses runStream merges output_item.done when the terminal envelope omits output", async () => {
  const item: ResponseOutputItem = {
    id: "msg_collected",
    type: "message",
    role: "assistant",
    status: "completed",
    content: [{ type: "output_text", text: "collected", annotations: [] }],
  };
  const terminal: JoyTokenResponse = {
    id: "terminal",
    object: "response",
    status: "completed",
    model: "terminal-model",
    usage: { input_tokens: 7, output_tokens: 1, total_tokens: 8 },
    metadata: { source: "terminal" },
  };
  const sse = new Response(
    `data: {"type":"response.output_item.done","sequence_number":0,"output_index":0,"item":${JSON.stringify(item)}}\n\ndata: {"type":"response.completed","sequence_number":1,"response":${JSON.stringify(terminal)}}\n\ndata: [DONE]\n\n`,
    { headers: { "Content-Type": "text/event-stream" } },
  );
  const { client } = mockClient([sse]);

  const result = await client.responses.runStream({ model: "auto", input: "collect", tools: [] });

  assert.equal(result.id, "terminal");
  assert.equal(result.model, "terminal-model");
  assert.equal(result.status, "completed");
  assert.deepEqual(result.usage, terminal.usage);
  assert.deepEqual(result.metadata, terminal.metadata);
  assert.deepEqual(result.output, [item]);
  assert.equal(result.output_text, "collected");
});

test("Responses Base URL variants derive exactly one native endpoint", async () => {
  const variants = [
    { apiBaseUrl: "https://gateway.test" },
    { apiBaseUrl: "https://gateway.test/" },
    { apiBaseUrl: "https://gateway.test/openai/v1" },
    { apiBaseUrl: "https://gateway.test/openai/v1/" },
    { apiBaseUrl: "https://gateway.test/openai/v1/responses/" },
    { apiBaseUrl: "https://ignored.test", openAIBaseUrl: "https://gateway.test/openai/v1/chat/completions" },
    { anthropicBaseUrl: "https://gateway.test/anthropic/v1/messages" },
  ];
  for (const variant of variants) {
    const current = mockClient([response()], variant);
    await current.client.responses.create({ model: "auto", input: "route", tools: [] });
    assert.equal(current.requests[0]?.url, "https://gateway.test/openai/v1/responses");
  }
});
