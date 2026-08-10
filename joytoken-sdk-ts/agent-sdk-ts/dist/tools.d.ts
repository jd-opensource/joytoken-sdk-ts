import type { AgentTool, ChatTool } from "./types.js";
export declare function defineTool<TInput = unknown, TOutput = unknown>(tool: AgentTool<TInput, TOutput>): AgentTool<TInput, TOutput>;
export declare function toChatTool(tool: AgentTool): ChatTool;
export declare function stringifyToolResult(value: unknown): string;
//# sourceMappingURL=tools.d.ts.map