import type { AgentTool, ChatTool } from "./types.js";

export function defineTool<TInput = unknown, TOutput = unknown>(tool: AgentTool<TInput, TOutput>): AgentTool<TInput, TOutput> {
  return tool;
}

export function toChatTool(tool: AgentTool): ChatTool {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters ?? { type: "object", properties: {} },
    },
  };
}

export function stringifyToolResult(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value) ?? "null";
}
