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

The client supports:

- `POST /openai/v1/chat/completions`
- streaming chat completions via SSE
- `POST /openai/v1/responses`
- streaming Responses text events via SSE
- `POST /openai/v1/images/generations`
- `POST /anthropic/v1/messages`
- streaming Anthropic Messages via SSE
- `GET /api/v1/models`
- `GET /api/v1/models/meta`
- `GET /api/v1/pricing`

The default endpoint is `https://api.joytokens.ai`; requests time out after 60 seconds by default. Pass `timeoutMs: 0` to disable the SDK timeout, or pass `apiBaseUrl`, `openAIBaseUrl`, and `anthropicBaseUrl` to target another environment. Authenticated model calls, model metadata and pricing requests fail locally when the API key is missing; `models.list()` remains unauthenticated. HTTP failures throw `JoyTokenAPIError` with the status, request ID, response headers, and parsed response body.

Streaming methods return an `AsyncIterable`. Breaking out of the loop cancels the underlying response body.

```ts
for await (const chunk of joytoken.chat.completions.stream({
  model: "auto",
  messages: [{ role: "user", content: "Say hello" }],
})) {
  process.stdout.write(String(chunk.choices[0]?.delta.content ?? ""));
}
```

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
  await joytoken.models.list();
} catch (error) {
  if (error instanceof JoyTokenAPIError) {
    console.error(error.status, error.requestId, error.body);
  }
}
```
