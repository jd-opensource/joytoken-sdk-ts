import { JoyTokenClient } from "@joytoken/client-sdk-ts";
import type { OrchestrationEvent } from "@joytoken/client-sdk-ts";

const apiKey = process.env.JOY_TOKEN_API_KEY;
const apiBaseUrl = process.env.JOY_TOKEN_API_BASE_URL ?? "https://api.joytokens.ai";
const openAIBaseUrl = process.env.JOY_TOKEN_OPENAI_BASE_URL ?? `${apiBaseUrl.replace(/\/+$/, "")}/openai/v1`;

if (!apiKey) {
  throw new Error("Set JOY_TOKEN_API_KEY before running the orchestration live probe.");
}

const model = process.env.JOY_TOKEN_MODEL ?? "auto";
const client = new JoyTokenClient({ apiKey, apiBaseUrl, openAIBaseUrl, timeoutMs: 120_000 });

console.log(`Orchestration live probe`);
console.log(`API base URL: ${apiBaseUrl}`);
console.log(`OpenAI base URL: ${openAIBaseUrl}`);
console.log(`Model: ${model}`);
const events: OrchestrationEvent[] = [];
const deltas: string[] = [];

const response = await client.chat.completions.runStream(
  {
    model,
    messages: [
      {
        role: "user",
        content:
          "需要任务编排：我今天想去深圳一日游，至少三个地方，喜欢吃东西，不要太阳，当前是关键字的方式",
      },
    ],
  },
  {
    onTextDelta: (delta) => {
      deltas.push(delta);
      process.stdout.write(delta);
    },
    onOrchestrationEvent: (event) => {
      events.push(event);
      if (event.type === "plan") {
        console.log(`\n[PLAN] ${event.plan.map((p) => `${p.seq}.${p.title ?? p.task_id}`).join(" | ")}`);
      } else {
        console.log(
          `\n[STAGE] task=${event.task_id ?? event.task_seq} status=${event.task_status ?? "-"} final=${event.final} title=${event.title ?? "-"}`,
        );
      }
    },
  },
);

console.log("\n\n===== RESULT =====");
console.log(`finish_reason: ${response.choices[0]?.finish_reason}`);
console.log(`\nfinal content (user-facing):\n${response.choices[0]?.message.content ?? "(empty)"}`);

console.log(`\n----- orchestration summary -----`);
if (response.orchestration) {
  console.log(`plan items: ${response.orchestration.plan?.length ?? 0}`);
  for (const stage of response.orchestration.stages) {
    console.log(
      `  stage task=${stage.task_id ?? stage.task_seq} status=${stage.task_status ?? "-"} contentLen=${stage.content.length}`,
    );
  }
} else {
  console.log("no orchestration metadata returned (non-orchestrated turn)");
}

console.log(`\nplan events: ${events.filter((e) => e.type === "plan").length}`);
console.log(`stage events: ${events.filter((e) => e.type === "stage").length}`);
console.log(`text deltas: ${deltas.length}`);