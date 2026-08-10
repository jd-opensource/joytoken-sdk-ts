export function stepCountIs(maxSteps) {
    return (state) => ({
        stop: state.step >= maxSteps,
        reason: `step_count:${maxSteps}`,
    });
}
export function maxToolCalls(maxCalls) {
    return (state) => ({
        stop: state.toolCalls >= maxCalls,
        reason: `max_tool_calls:${maxCalls}`,
    });
}
export function maxCost(maxCredits) {
    return (state) => ({
        stop: (state.usage.cost ?? 0) >= maxCredits,
        reason: `max_cost:${maxCredits}`,
    });
}
export function shouldStop(stopWhen, state) {
    for (const condition of stopWhen) {
        const decision = condition(state);
        if (typeof decision === "boolean") {
            if (decision)
                return "custom";
            continue;
        }
        if (decision.stop)
            return decision.reason ?? "custom";
    }
    return undefined;
}
export function emptyUsage() {
    return { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
}
export function addUsage(summary, usage) {
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
function numberValue(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
function optionalNumberValue(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
//# sourceMappingURL=stop.js.map