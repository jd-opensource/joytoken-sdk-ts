# JoyToken SDKs for TypeScript

English | [简体中文](README_CN.md)

This repository contains the first-party TypeScript SDK surface for JoyToken.

The packages use the standard `fetch` API and work in Node.js 18+ and modern browsers. Keep API keys in a trusted server-side environment when browser exposure is not explicitly intended.

## Installation

The SDK is installed directly from GitHub and is not published to the npm registry. Add the client package's GitHub subdirectory to your project's `package.json`:

```json
{
  "type": "module",
  "dependencies": {
    "@joytoken/client-sdk-ts": "git+https://github.com/jd-opensource/joytoken-sdk-ts.git#path:/client-sdk-ts"
  }
}
```

Then install dependencies:

```bash
pnpm install
```

To use the Agent SDK, declare both GitHub subdirectories as direct dependencies. The client package is a peer dependency of the Agent SDK.

```json
{
  "type": "module",
  "dependencies": {
    "@joytoken/agent-sdk-ts": "git+https://github.com/jd-opensource/joytoken-sdk-ts.git#path:/agent-sdk-ts",
    "@joytoken/client-sdk-ts": "git+https://github.com/jd-opensource/joytoken-sdk-ts.git#path:/client-sdk-ts"
  }
}
```

These addresses follow the repository's default branch. For reproducible production builds, pin a release tag or commit, for example `#v0.2.0&path:/client-sdk-ts`.

## Quick start

```bash
export JOY_TOKEN_API_KEY="..."
```

Create `index.mjs`:

```js
import { JoyTokenClient } from "@joytoken/client-sdk-ts";

const client = new JoyTokenClient({
  apiKey: process.env.JOY_TOKEN_API_KEY,
});

const completion = await client.chat.completions.create({
  model: "auto",
  messages: [{ role: "user", content: "Say hello" }],
});

console.log(completion.choices[0]?.message.content);
```

Run it with:

```bash
node index.mjs
```

## Packages

- [`client-sdk-ts`](client-sdk-ts/README.md): TypeScript client for JoyToken OpenAI Chat Completions, Responses, Anthropic Messages, streaming, and model discovery.
- [`agent-sdk-ts`](agent-sdk-ts/README.md): TypeScript agent helpers built on top of `client-sdk-ts`.
- `example`: offline smoke tests using a local mock JoyToken server, plus an opt-in live example for real JoyToken API calls.

## Supported APIs

The Gateway has one base URL and two public OpenAI protocol endpoints. Anthropic Messages is the SDK-side compatibility adapter over Chat Completions:

- `POST /openai/v1/chat/completions`
- `POST /openai/v1/responses`
- `POST /openai/v1/images/generations`
- `GET /api/v1/models`
- `GET /api/v1/models/meta`
- `GET /api/v1/pricing`

Embeddings and public management APIs are not exposed here until the gateway publishes stable contracts for them.

## Configuration

The default endpoint is `https://api.joytokens.ai`. Requests time out after 60 seconds by default; pass `timeoutMs: 0` to disable that limit. Use `JOY_TOKEN_API_BASE_URL` or the legacy `JOY_TOKEN_OPENAI_BASE_URL` to target another environment. The legacy Anthropic base option is retained for source compatibility but never selects a separate model route.

Authenticated model calls, model metadata and pricing requests fail locally with a clear error when no API key is configured. `models.list()` remains the unauthenticated catalog call.

All model requests require `model: "auto"`; concrete model IDs are rejected locally by the SDK.

Model description language is selected per `models.list()` call, not in global client configuration. Pass `{ locale: "zh" }` or `{ locale: "en" }`; omitting it defaults to English. The SDK preserves the API response envelope, so catalog entries are in `response.data.models`.

## Repository development

The following commands are for contributors working from a source checkout. The repository already contains the root `package.json`, workspace manifest, and lockfile:

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm build
```

## Distribution

This project is distributed from GitHub rather than npm. The compiled `dist/` files are committed so consumers can install a Git revision without running the TypeScript toolchain. Before tagging a release, rebuild and commit the generated files:

```bash
pnpm build
git diff --exit-code -- client-sdk-ts/dist agent-sdk-ts/dist
```

## Live example

The live example calls JoyToken and requires a real API key:

```bash
cd example
export JOY_TOKEN_API_KEY="..."
pnpm live
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
