# @joytoken/client-sdk-ts

TypeScript client for JoyToken's current public developer API. Requires Node.js 18+ or a modern runtime with `fetch`, `ReadableStream`, and `TextDecoder`.

Install directly from the GitHub subdirectory by adding the dependency to your project's `package.json`:

```json
{
  "dependencies": {
    "@joytoken/client-sdk-ts": "git+https://github.com/jd-opensource/joytoken-sdk-ts.git#path:/client-sdk-ts"
  }
}
```

```bash
pnpm install
```

```ts
import { JoyTokenClient } from "@joytoken/client-sdk-ts";

const joytoken = new JoyTokenClient({
  apiKey: process.env.JOY_TOKEN_API_KEY,
});

const completion = await joytoken.chat.completions.create({
  model: "auto",
  messages: [{ role: "user", content: "Say hello" }],
});

console.log(completion.choices[0]?.message?.content);
```

OpenAI Responses:

```ts
const response = await joytoken.responses.create({
  model: "auto",
  input: "Say hello",
});

console.log(response.output?.[0]?.content?.[0]?.text);
```

OpenAI Images:

```ts
const image = await joytoken.images.generate({
  model: "auto",
  prompt: "A neon JoyToken logo on a black background",
  size: "1024x1024",
});

console.log(image.data[0]?.url ?? image.data[0]?.b64_json);
```

Anthropic Messages:

```ts
const message = await joytoken.messages.create({
  model: "auto",
  max_tokens: 1024,
  messages: [{ role: "user", content: "Say hello" }],
});

console.log(message.content[0]?.text);
```

The Gateway exposes native Chat Completions and Responses endpoints. Only Anthropic Messages is converted to and from Chat Completions inside the SDK. The client supports:

- `POST /openai/v1/chat/completions`
- streaming chat completions via SSE
- `POST /openai/v1/responses`, including native output items and native SSE events
- `POST /openai/v1/images/generations`
- SDK-side Anthropic Messages compatibility, including streaming events
- `GET /api/v1/models`
- `GET /api/v1/models/meta`
- `GET /api/v1/pricing`

The default endpoint is `https://api.joytokens.ai`; requests time out after 60 seconds by default. Automatic retries are disabled by default because model requests are not inherently idempotent; set `maxRetries` to a positive value only when the caller accepts that risk and has an appropriate idempotency strategy. Pass `timeoutMs: 0` to disable the SDK timeout, or pass `apiBaseUrl`/`openAIBaseUrl` to target another environment. `anthropicBaseUrl` remains accepted for source compatibility but never routes to a separate Messages endpoint. Authenticated model calls, model metadata and pricing requests fail locally when the API key is missing; `models.list()` remains unauthenticated. HTTP failures throw `JoyTokenAPIError` with the status, request ID, response headers, and parsed response body.

Tool ownership is exclusive. An explicit `request.tools` value, including `[]`, is sent without SDK defaults. Otherwise Client-registered tools are used alone. Only when neither exists are local SDK defaults injected and allowed to auto-run. Every tool-loop turn carries the same resolved tools and request options exactly once. `create` and raw `stream` never execute user tools; call `run`/`executeTools` or the streaming `runStream`/`executeToolsStream` entry points to execute Client-registered handlers. Responses tools stay in the native flat shape, and `function_call_output` items are appended to native Responses input. Responses hosted defaults are disabled unless `defaultBuiltinTools: true` is set; hosted `file_search` must be supplied by the caller with its `vector_store_ids`.

`ToolCall.extra_content` is opaque provider extension data. SDK-managed `run`/`executeTools` loops preserve it across Chat Completions, Responses, and Anthropic Messages continuations, including streamed tool calls whose extension objects arrive in multiple chunks. For example, Gemini may return `extra_content.google.thought_signature`; the SDK neither interprets nor manufactures that value. Custom loops must replay the complete returned `ToolCall` (or the complete Responses `function_call` / Messages `tool_use` item) instead of rebuilding only `id` and `function`, otherwise provider-required continuation metadata can be lost. When the provider does not return `extra_content`, the SDK does not add an empty object.

All model requests require `model: "auto"`; concrete model IDs are rejected before a network request is sent.

Use `models.list({ locale: "zh" })` or `models.list({ locale: "en" })` to select the language of each model description. `locale` is a per-call catalog option, not global client configuration. When it is omitted, the API defaults to English. Catalog entries are returned in `response.data.models`, matching the HTTP response envelope.

Streaming methods return an `AsyncIterable`. Breaking out of the loop cancels the underlying response body.

```ts
for await (const chunk of joytoken.chat.completions.stream({
  model: "auto",
  messages: [{ role: "user", content: "Say hello" }],
})) {
  const content = chunk.choices?.[0]?.delta?.content;
  if (content) process.stdout.write(String(content));
}
```

Chat streams may contain metadata-only or usage-only SSE events. The SDK preserves
those fields and normalizes `chunk.choices` to `[]`, so every emitted
`ChatCompletionChunk` matches its TypeScript contract. Consumers should still
read deltas defensively as shown above because not every event carries text.

When the Gateway omits token usage, Chat and Responses keep `usage` absent rather
than inventing billing data. Anthropic Messages requires numeric token fields, so
the compatibility adapter returns zeroes and sets
`metadata.joytoken.usage_status` to `"unavailable"`; those zeroes are compatibility
values, not measured usage. HTTP and provider errors, including upstream 503s,
are always surfaced as `JoyTokenAPIError` and are never converted into success.
For model HTTP failures, `error.context` identifies the public protocol, whether
the failure happened on the initial request or a tool continuation, the
one-based request/tool step, and the involved tool IDs/names. It records only
diagnostic metadata (never tool arguments or results), preserves the original
status/body/headers/request ID, and does not retry or execute a tool again.

```ts
for await (const event of joytoken.responses.stream({
  model: "auto",
  input: "Say hello",
})) {
  if (event.type === "response.output_text.delta") {
    process.stdout.write(event.delta ?? "");
  }
}
```

```ts
import { JoyTokenAPIError } from "@joytoken/client-sdk-ts";

try {
  await joytoken.chat.completions.run({
    model: "auto",
    messages: [{ role: "user", content: "Use the registered tool" }],
  });
} catch (error) {
  if (error instanceof JoyTokenAPIError) {
    console.error(error.status, error.requestId, error.message, error.body, error.context);
    // context.phase is "initial_request", "tool_continuation", or
    // "repair_continuation". A tool continuation also reports whether each
    // returned ToolCall included opaque extra_content.
  }
}
```
