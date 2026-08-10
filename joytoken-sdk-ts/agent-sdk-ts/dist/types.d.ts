import type { ChatMessage, ChatTool, JoyTokenClientOptions, ToolCall, Usage } from "@joytoken/client-sdk-ts";
export type { ChatMessage, ChatTool, JoyTokenClientOptions, ToolCall, Usage };
export interface ModelProvider {
    complete(request: ModelRequest): Promise<ModelResponse>;
}
export interface ModelRequest {
    model: string;
    messages: ChatMessage[];
    tools?: ChatTool[];
    temperature?: number;
    maxTokens?: number;
    tier?: string;
    metadata?: Record<string, unknown>;
}
export interface ModelResponse {
    message: ChatMessage;
    usage?: Usage;
    raw?: unknown;
}
export interface AgentTool<TInput = unknown, TOutput = unknown> {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
    execute(input: TInput, context: ToolExecutionContext): Promise<TOutput> | TOutput;
}
export interface ToolExecutionContext {
    step: number;
    toolCall: ToolCall;
    messages: ChatMessage[];
}
export interface AgentOptions {
    model: ModelProvider;
    modelName?: string;
    system?: string;
    tools?: AgentTool[];
    stopWhen?: StopCondition[];
    temperature?: number;
    maxTokens?: number;
    tier?: string;
    metadata?: Record<string, unknown>;
}
export interface AgentRunOptions {
    messages?: ChatMessage[];
    input?: string;
    maxSteps?: number;
    metadata?: Record<string, unknown>;
}
export interface AgentResult {
    finalText: string;
    messages: ChatMessage[];
    steps: AgentStep[];
    usage: UsageSummary;
    stoppedBy?: string;
}
export interface AgentStep {
    index: number;
    assistantMessage: ChatMessage;
    toolResults: ToolResult[];
    usage?: Usage;
}
export interface ToolResult {
    toolCallId: string;
    toolName: string;
    content: string;
}
export interface UsageSummary {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cost?: number;
}
export interface AgentState {
    step: number;
    toolCalls: number;
    usage: UsageSummary;
    messages: ChatMessage[];
}
export interface StopDecision {
    stop: boolean;
    reason?: string;
}
export type StopCondition = (state: AgentState) => StopDecision | boolean;
//# sourceMappingURL=types.d.ts.map