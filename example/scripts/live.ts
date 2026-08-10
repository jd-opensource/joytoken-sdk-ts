import { Agent, createJoyTokenProvider } from "@joytoken/agent-sdk-ts";
import { JoyTokenClient } from "@joytoken/client-sdk-ts";

const apiKey = process.env.JOY_TOKEN_API_KEY;
const apiBaseUrl = process.env.JOY_TOKEN_API_BASE_URL ?? "https://api.joytokens.ai";
const openAIBaseUrl = process.env.JOY_TOKEN_OPENAI_BASE_URL ?? `${apiBaseUrl.replace(/\/+$/, "")}/openai/v1`;
const model = process.env.JOY_TOKEN_MODEL ?? "auto";

if (!apiKey) {
  throw new Error("Set JOY_TOKEN_API_KEY before running the live JoyToken example.");
}

const client = new JoyTokenClient({
  apiKey,
  apiBaseUrl,
  openAIBaseUrl,
  timeoutMs: 60_000,
});

console.log(`JoyToken live example`);
console.log(`API base URL: ${apiBaseUrl}`);
console.log(`OpenAI base URL: ${openAIBaseUrl}`);
console.log(`Model: ${model}`);

const models = await client.models.list();
console.log(`Models returned: ${models.data.length}`);
if (models.data[0]) {
  console.log(`First model: ${models.data[0].id}`);
}

const completion = await client.chat.completions.create({
  model,
  messages: [{ role: "user", content: "Reply with one short sentence confirming JoyToken is connected." }],
  max_tokens: 80,
});

console.log("\nClient SDK response:");
console.log(completion.choices[0]?.message.content ?? "");

const agent = new Agent({
  modelName: model,
  model: createJoyTokenProvider({
    apiKey,
    apiBaseUrl,
    openAIBaseUrl,
    defaultModel: model,
    timeoutMs: 60_000,
  }),
  system: "You are testing the JoyToken Agent SDK. Keep the answer short.",
  maxTokens: 80,
});

const result = await agent.run("Confirm the Agent SDK can call JoyToken through the configured provider.");

console.log("\nAgent SDK response:");
console.log(result.finalText);
console.log(`Usage total tokens: ${result.usage.totalTokens}`);
