# TypeScript example

Examples for the JoyToken TypeScript SDKs.

The default tests use local mock servers, so they do not require a real JoyToken API key.

```bash
pnpm test
```

## Live JoyToken call

Live examples call `https://api.joytokens.ai` and require a real API key.
Do not commit `.env` files or API keys.

```bash
export JOY_TOKEN_API_KEY="..."
export JOY_TOKEN_API_BASE_URL="https://api.joytokens.ai"
export JOY_TOKEN_OPENAI_BASE_URL="https://api.joytokens.ai/openai/v1"
export JOY_TOKEN_MODEL="auto"

pnpm live
```
