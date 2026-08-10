import type { AgentState, StopCondition, UsageSummary } from "./types.js";

export function stepCountIs(maxSteps: number): StopCondition {
  return (state: AgentState) => ({
    stop: state.step >= maxSteps,
    reason: `step_count:${maxSteps}`,
  });
}

export function maxToolCalls(maxCalls: number): StopCondition {
  return (state: AgentState) => ({
    stop: state.toolCalls >= maxCalls,
    reason: `max_tool_calls:${maxCalls}`,
  });
}

export function maxCost(maxCredits: number): StopCondition {
  return (state: AgentState) => ({
    stop: (state.usage.cost ?? 0) >= maxCredits,
    reason: `max_cost:${maxCredits}`,
  });
}

export function shouldStop(stopWhen: StopCondition[], state: AgentState): string | undefined {
  for (const condition of stopWhen) {
    const decision = condition(state);
    if (typeof decision === "boolean") {
      if (decision) return "custom";
      continue;
    }
    if (decision.stop) return decision.reason ?? "custom";
  }
  return undefined;
}

export function emptyUsage(): UsageSummary {
  return { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
}

export function addUsage(summary: UsageSummary, usage?: Record<string, unknown>): UsageSummary {
  const promptTokens = numberValue(usage?.prompt_tokens);
  const completionTokens = numberValue(usage?.completion_tokens);
  const totalTokens = numberValue(usage?.total_tokens);
  const cost = optionalNumberValue(usage?.cost ?? usage?.total_cost);

  return {
    promptTokens: summary.promptTokens + promptTokens,
    completionTokens: summary.completionTokens + completionTokens,
    totalTokens: summary.totalTokens + totalTokens,
    cost: cost !== undefined || summary.cost !== undefined ? (summary.cost ?? 0) + (cost ?? 0) : undefined,
  };
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function optionalNumberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
