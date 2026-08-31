import { JoyTokenClient } from "@joytoken/client-sdk-ts";

const apiKey = process.env.JOY_TOKEN_API_KEY!;
const apiBaseUrl = process.env.JOY_TOKEN_API_BASE_URL ?? "https://api.joytokens.ai";
const openAIBaseUrl = `${apiBaseUrl.replace(/\/+$/, "")}/openai/v1`;
const prompt =
  process.env.JOY_TOKEN_PROMPT ??
  "深入研究并分多个步骤完成:对比 React、Vue、Svelte 的响应式原理、性能与生态,先分别检索再综合给出选型建议报告。";

const client = new JoyTokenClient({ apiKey, apiBaseUrl, openAIBaseUrl, timeoutMs: 180_000 });

let count = 0;
let sawOrchestration = false;
for await (const chunk of client.chat.completions.stream({
  model: "auto",
  messages: [{ role: "user", content: prompt }],
})) {
  count += 1;
  const raw = chunk as unknown as Record<string, unknown>;
  if (raw.orchestration !== undefined) {
    sawOrchestration = true;
    // Print the raw orchestration payload exactly as the gateway sent it.
    console.log(`#${count} orchestration=${JSON.stringify(raw.orchestration)}`);
  }
  const delta = (chunk.choices?.[0]?.delta ?? {}) as Record<string, unknown>;
  console.log(`#${count} RAW: ${JSON.stringify(raw).slice(0, 800)}`);
  if (typeof delta.content === "string" && delta.content) {
    console.log(`#${count} content(${delta.content.length}): ${delta.content.slice(0, 40).replace(/\n/g, " ")}`);
  }
}

console.log(`\ntotal chunks: ${count}`);
console.log(`saw orchestration field: ${sawOrchestration}`);