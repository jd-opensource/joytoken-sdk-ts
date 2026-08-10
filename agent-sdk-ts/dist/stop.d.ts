import type { AgentState, StopCondition, UsageSummary } from "./types.js";
export declare function stepCountIs(maxSteps: number): StopCondition;
export declare function maxToolCalls(maxCalls: number): StopCondition;
export declare function maxCost(maxCredits: number): StopCondition;
export declare function shouldStop(stopWhen: StopCondition[], state: AgentState): string | undefined;
export declare function emptyUsage(): UsageSummary;
export declare function addUsage(summary: UsageSummary, usage?: Record<string, unknown>): UsageSummary;
//# sourceMappingURL=stop.d.ts.map