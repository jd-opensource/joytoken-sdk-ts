import assert from "node:assert/strict";
import { test } from "node:test";
import { parseOrchestrationResponse } from "../src/index.js";
import type { ChatCompletionResponse } from "../src/index.js";

// A non-streaming orchestration response the gateway may return: a top-level
// `plan`, a per-sub-task `metadata` array, and per-sub-task content encoded as
// a JSON string inside choices[].message.content.
function fixture(content: unknown): ChatCompletionResponse {
  return {
    id: "orc-nonstream",
    model: "m",
    choices: [{ index: 0, message: { role: "assistant", content: content as never }, finish_reason: "stop" }],
    plan: [
      { seq: 1, task_id: "search", title: "Search" },
      { seq: 2, task_id: "__final__", title: "Answer" },
    ],
    metadata: [
      { task_id: "search", task_seq: 1, task_status: "DONE", title: "Search", model: "m-a", tier: "std", latency: { first_token_ms: 40, stream_ms: 120 } },
      { task_id: "__final__", task_seq: 2, task_status: "DONE", title: "Answer", model: "m-b" },
    ],
  } as ChatCompletionResponse;
}

test("parseOrchestrationResponse folds planand metadata into an OrchestrationResult", () => {
  const content = JSON.stringify([
    { task_id: "search", content: "searching..." },
    { task_id: "__final__", content: "final answer" },
  ]);
  const result = parseOrchestrationResponse(fixture(content));
  assert.ok(result);
  assert.deepEqual(result?.plan?.map((p) => p.task_id), ["search", "__final__"]);
  assert.deepEqual(result?.stages.map((s) => s.task_id), ["search", "__final__"]);
  const search = result?.stages.find((s) => s.task_id === "search");
  assert.equal(search?.content, "searching...");
  // Metadata is merged into the matching stage.
  assert.equal(search?.task_status, "DONE");
  assert.equal(search?.title, "Search");
  assert.equal(search?.task_seq, 1);
  const final = result?.stages.find((s) => s.task_id === "__final__");
  assert.equal(final?.content, "final answer");
});

test("parseOrchestrationResponse accepts structured (non-string) content arrays", () => {
  const result = parseOrchestrationResponse(
    fixture([
      { task_id: "search", content: "s" },
      { task_id: "__final__", content: "f" },
    ]),
  );
  assert.deepEqual(result?.stages.map((s) => s.content), ["s", "f"]);
});

test("parseOrchestrationResponse emits metadata-only stages when content is empty", () => {
  const resp = fixture("");
  const result = parseOrchestrationResponse(resp);
  assert.ok(result);
  // Both announced sub-tasks are represented even with no content.
  assert.deepEqual(result?.stages.map((s) => s.task_id).sort(), ["__final__", "search"]);
  assert.ok(result?.stages.every((s) => s.content === ""));
});

test("parseOrchestrationResponse returns undefined for a non-orchestrated response", () => {
  const plain: ChatCompletionResponse = {
    id: "chat",
    model: "m",
    choices: [{ index: 0, message: { role: "assistant", content: "hi" }, finish_reason: "stop" }],
  };
  assert.equal(parseOrchestrationResponse(plain), undefined);
  assert.equal(parseOrchestrationResponse(undefined), undefined);
});

// A plain chat turn can still carry a single bookkeeping metadata row (model /
// billing info) whose task_id, task_seq and title are all absent. That is NOT
// orchestration and must return undefined, matching the streaming aggregator
// which surfaces no orchestration for plain chat. (Observed on real staging for
// the prompt "给我介绍下新加坡": metadata len 1, no plan, ids/titles null.)
test("parseOrchestrationResponse ignores a bookkeeping-only metadata row", () => {
  const resp: ChatCompletionResponse = {
    id: "chat",
    model: "m",
    choices: [{ index: 0, message: { role: "assistant", content: "Singapore is..." }, finish_reason: "stop" }],
    metadata: [{ model: "m-a", tier: "std", latency: { stream_ms: 90 } } as never],
  } as ChatCompletionResponse;
  assert.equal(parseOrchestrationResponse(resp), undefined);
});

test("parseOrchestrationResponse tolerates malformed JSON content", () => {
  const resp = fixture("{not valid json");
  const result = parseOrchestrationResponse(resp);
  assert.ok(result);
  // Falls back to treating the raw string as a single stage's content, then
  // still surfaces the announced metadata sub-tasks.
  assert.ok(result?.stages.length && result.stages.length >= 1);
});

// The real staging gateway emits per-sub-task content that carries only
// `content` + `title` (no task_id/task_seq), while the metadata array carries
// the identifiers plus a title-less `__planner__` control entry. Stages must be
// reunited by *title* and the planner placeholder must not become a stage —
// otherwise content and metadata stack up as duplicates (the stages=11 bug).
test("parseOrchestrationResponse merges title-only content with metadata by title", () => {
  const resp: ChatCompletionResponse = {
    id: "orc-real",
    model: "m",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: JSON.stringify([
            { content: "food picks", title: "寻找美食地点" },
            { content: "itinerary plan", title: "规划一日游路线" },
            { content: "summary", title: "汇总" },
          ]) as never,
        },
        finish_reason: "stop",
      },
    ],
    plan: [
      { seq: 3, task_id: "food", title: "寻找美食地点" },
      { seq: 4, task_id: "itinerary", title: "规划一日游路线" },
      { seq: 5, task_id: "__final__", title: "汇总" },
    ],
    metadata: [
      { task_id: "__planner__", task_seq: 0, task_status: "DONE" },
      { task_id: "food", task_seq: 3, task_status: "DONE", title: "寻找美食地点" },
      { task_id: "itinerary", task_seq: 4, task_status: "DONE", title: "规划一日游路线" },
      { task_id: "__final__", task_seq: 5, task_status: "DONE", title: "汇总" },
    ],
  } as ChatCompletionResponse;

  const result = parseOrchestrationResponse(resp);
  assert.ok(result);
  // Three content stages, no duplicated metadata rows and no planner stage.
  assert.equal(result?.stages.length, 3);
  const food = result?.stages.find((s) => s.title === "寻找美食地点");
  assert.equal(food?.content, "food picks");
  // Identifiers were reunited from metadata purely by title match.
  assert.equal(food?.task_id, "food");
  assert.equal(food?.task_seq, 3);
  assert.equal(food?.task_status, "DONE");
  // The title-less planner placeholder never becomes a stage.
  assert.ok(result?.stages.every((s) => s.task_id !== "__planner__"));
});