import { JoyTokenClient } from "@joytoken/client-sdk-ts";

const apiKey = process.env.JOY_TOKEN_API_KEY!;
const apiBaseUrl = process.env.JOY_TOKEN_API_BASE_URL ?? "https://api.joytokens.ai";
const openAIBaseUrl = `${apiBaseUrl.replace(/\/+$/, "")}/openai/v1`;

const client = new JoyTokenClient({ apiKey, apiBaseUrl, openAIBaseUrl, timeoutMs: 60_000 });

const models = await client.models.list();
const sample = (models.data.models as any[]).find((m) => (m.featureTags ?? []).includes("orchestration"));
console.log("keys:", Object.keys(sample ?? {}).join(","));
console.log("sample:", JSON.stringify(sample, null, 2));