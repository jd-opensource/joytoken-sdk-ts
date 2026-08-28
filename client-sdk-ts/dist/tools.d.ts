import type { ChatMessage, ChatTool, MessageTool, ResponseFunctionTool, ToolCall } from "./types.js";
/**
 * ToolExecuteFunc is the signature of a tool's execution function. Naming the
 * type lets middleware and toolkits compose execute functions without repeating
 * the full signature.
 */
export type ToolExecuteFunc<TInput = unknown, TOutput = unknown> = (input: TInput, context: ToolExecutionContext) => Promise<TOutput> | TOutput;
/**
 * ToolExecutionContext contains the state available to a tool invocation.
 */
export interface ToolExecutionContext {
    step: number;
    toolCall: ToolCall;
    messages: ChatMessage[];
}
/**
 * Tool is the shared tool abstraction. It lives in client-sdk-ts (the bottom of
 * the dependency graph — agent-sdk-ts depends on this package, never the other
 * way round) so both the root client's execution loop and the agent package can
 * reuse the exact same definitions and the default tool implementations without
 * an import cycle.
 */
export interface Tool<TInput = unknown, TOutput = unknown> {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
    execute?: ToolExecuteFunc<TInput, TOutput>;
}
/**
 * defineTool returns the tool unchanged and documents the intended construction
 * point for code that shares tool definitions across packages.
 */
export declare function defineTool<TInput = unknown, TOutput = unknown>(tool: Tool<TInput, TOutput>): Tool<TInput, TOutput>;
/**
 * toChatTool converts a Tool into the wire-level ChatTool sent to the model.
 */
export declare function toChatTool(tool: Tool): ChatTool;
export declare function toResponseTool(tool: Tool): ResponseFunctionTool;
export declare function toMessageTool(tool: Tool): MessageTool;
/**
 * parseToolArguments decodes a tool call's raw JSON arguments into a generic
 * value. An empty string yields an empty object, and invalid JSON is wrapped as
 * { raw: value } so a malformed model response never crashes the loop.
 */
export declare function parseToolArguments(value: string): unknown;
/**
 * stringifyToolResult serializes a tool result into the string content fed back
 * to the model as a tool-role message.
 */
export declare function stringifyToolResult(value: unknown): string;
/**
 * safeExecuteTool runs a tool's execute function and turns thrown errors and
 * rejected promises into a normal error return so a single tool never crashes
 * the execution loop.
 */
export declare function safeExecuteTool(execute: ToolExecuteFunc, input: unknown, context: ToolExecutionContext): Promise<{
    output?: unknown;
    error?: Error;
}>;
/**
 * MaxArgBytes caps the length of a single string argument extracted from tool
 * input. It is a coarse guard against a model sending a pathologically large
 * value that would be buffered in memory before a tool's own size checks run.
 */
export declare const MaxArgBytes: number;
/**
 * calculator returns a zero-dependency, local, side-effect-free tool that
 * evaluates an arithmetic expression. It supports + - * / % and parentheses
 * over floating-point numbers, and is part of the default tool set.
 */
export declare function calculator(): Tool;
/**
 * dateTime returns a zero-dependency, local, side-effect-free tool that reports
 * the current date and time. It accepts an optional IANA timezone name and is
 * part of the default tool set.
 */
export declare function dateTime(): Tool;
/**
 * evalExpression evaluates an arithmetic expression using a recursive-descent
 * parser. It supports + - * / % operators, unary minus, parentheses and
 * floating-point literals, with no external dependencies.
 */
export declare function evalExpression(input: string): number;
//# sourceMappingURL=tools.d.ts.map