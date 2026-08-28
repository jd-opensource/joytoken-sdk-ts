import { Agent, createJoyTokenProvider } from "@joytoken/agent-sdk-ts";
import { JoyTokenClient } from "@joytoken/client-sdk-ts";

const apiKey = process.env.JOY_TOKEN_API_KEY;
const apiBaseUrl = process.env.JOY_TOKEN_API_BASE_URL ?? "https://api.joytokens.ai";
const openAIBaseUrl = process.env.JOY_TOKEN_OPENAI_BASE_URL ?? `${apiBaseUrl.replace(/\/+$/, "")}/openai/v1`;

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
console.log("Model: auto");

const models = await client.models.list();
console.log(`Models returned: ${models.data.models.length}`);
if (models.data.models[0]) {
  console.log(`First model: ${models.data.models[0].alias}`);
}

const chatNonce = Date.now();
const completion = await client.chat.completions.create({
  model: "auto",
  messages: [
    {
      role: "user",
      content: `Reply with one short sentence confirming JoyToken is connected. (probe nonce ${chatNonce}, ignore this number)`,
    },
  ],
  max_tokens: 80,
});

console.log("\nClient SDK response:");
console.log(completion.choices[0]?.message.content ?? "");

const agent = new Agent({
  model: createJoyTokenProvider({
    apiKey,
    apiBaseUrl,
    openAIBaseUrl,
    timeoutMs: 60_000,
  }),
  system: "You are testing the JoyToken Agent SDK. Keep the answer short.",
  maxTokens: 80,
});

const nonce = Date.now();
const result = await agent.run(
  `Confirm the Agent SDK can call JoyToken through the configured provider. (probe nonce ${nonce}, ignore this number)`,
);

console.log("\nAgent SDK response:");
console.log(result.finalText);
console.log(`Usage total tokens: ${result.usage.totalTokens}`);
