import type { ChatMessage, ChatTool, MessageTool, ResponseFunctionTool, ToolCall } from "./types.js";

/**
 * ToolExecuteFunc is the signature of a tool's execution function. Naming the
 * type lets middleware and toolkits compose execute functions without repeating
 * the full signature.
 */
export type ToolExecuteFunc<TInput = unknown, TOutput = unknown> = (
  input: TInput,
  context: ToolExecutionContext,
) => Promise<TOutput> | TOutput;

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
export function defineTool<TInput = unknown, TOutput = unknown>(tool: Tool<TInput, TOutput>): Tool<TInput, TOutput> {
  return tool;
}

/**
 * toChatTool converts a Tool into the wire-level ChatTool sent to the model.
 */
export function toChatTool(tool: Tool): ChatTool {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters ?? { type: "object", properties: {} },
    },
  };
}

export function toResponseTool(tool: Tool): ResponseFunctionTool {
  return {
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters ?? { type: "object", properties: {} },
  };
}

export function toMessageTool(tool: Tool): MessageTool {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters ?? { type: "object", properties: {} },
  };
}

/**
 * parseToolArguments decodes a tool call's raw JSON arguments into a generic
 * value. An empty string yields an empty object, and invalid JSON is wrapped as
 * { raw: value } so a malformed model response never crashes the loop.
 */
export function parseToolArguments(value: string): unknown {
  if (value === "") return {};
  try {
    return JSON.parse(value);
  } catch {
    return { raw: value };
  }
}

/**
 * stringifyToolResult serializes a tool result into the string content fed back
 * to the model as a tool-role message.
 */
export function stringifyToolResult(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return value;
  return JSON.stringify(value) ?? "null";
}

/**
 * safeExecuteTool runs a tool's execute function and turns thrown errors and
 * rejected promises into a normal error return so a single tool never crashes
 * the execution loop.
 */
export async function safeExecuteTool(
  execute: ToolExecuteFunc,
  input: unknown,
  context: ToolExecutionContext,
): Promise<{ output?: unknown; error?: Error }> {
  try {
    const output = await execute(input, context);
    return { output };
  } catch (error) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }
}

/**
 * MaxArgBytes caps the length of a single string argument extracted from tool
 * input. It is a coarse guard against a model sending a pathologically large
 * value that would be buffered in memory before a tool's own size checks run.
 */
export const MaxArgBytes = 1 << 20; // 1 MiB

/**
 * calculator returns a zero-dependency, local, side-effect-free tool that
 * evaluates an arithmetic expression. It supports + - * / % and parentheses
 * over floating-point numbers, and is part of the default tool set.
 */
export function calculator(): Tool {
  return defineTool({
    name: "calculator",
    description: 'Evaluate a math expression. Supports + - * / %, parentheses and decimals, e.g. "(2 + 3) * 4.5".',
    parameters: {
      type: "object",
      properties: {
        expression: { type: "string", description: "The arithmetic expression to evaluate." },
      },
      required: ["expression"],
    },
    execute: (input) => {
      const expression = stringArg(input, "expression");
      let value: number;
      try {
        value = evalExpression(expression);
      } catch (error) {
        throw new Error(`calculator: ${error instanceof Error ? error.message : String(error)}`);
      }
      return { result: value };
    },
  });
}

/**
 * dateTime returns a zero-dependency, local, side-effect-free tool that reports
 * the current date and time. It accepts an optional IANA timezone name and is
 * part of the default tool set.
 */
export function dateTime(): Tool {
  return defineTool({
    name: "datetime",
    description: 'Get the current date and time. Optionally specify an IANA timezone (e.g. "Asia/Shanghai"). Defaults to UTC.',
    parameters: {
      type: "object",
      properties: {
        timezone: {
          type: "string",
          description: 'IANA timezone name, e.g. "UTC" or "Asia/Shanghai". Defaults to UTC.',
        },
      },
    },
    execute: (input) => {
      const timezone = optionalStringArg(input, "timezone") || "UTC";
      const now = new Date();
      let formatted: string;
      try {
        formatted = new Intl.DateTimeFormat("sv-SE", {
          timeZone: timezone,
          dateStyle: "short",
          timeStyle: "medium",
        }).format(now);
      } catch (error) {
        throw new Error(`datetime: invalid timezone ${JSON.stringify(timezone)}: ${error instanceof Error ? error.message : String(error)}`);
      }
      return { datetime: formatted, timezone, unix: Math.floor(now.getTime() / 1000) };
    },
  });
}

function stringArg(input: unknown, key: string): string {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error(`expected object input, got ${describe(input)}`);
  }
  const object = input as Record<string, unknown>;
  if (!(key in object)) {
    throw new Error(`missing required argument ${JSON.stringify(key)}`);
  }
  const value = coerceString(object[key]);
  if (value.length > MaxArgBytes) {
    throw new Error(`argument ${JSON.stringify(key)} is ${value.length} bytes, exceeds limit of ${MaxArgBytes}`);
  }
  return value;
}

function optionalStringArg(input: unknown, key: string): string {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return "";
  const raw = (input as Record<string, unknown>)[key];
  return typeof raw === "string" ? raw : "";
}

function coerceString(raw: unknown): string {
  switch (typeof raw) {
    case "string":
      return raw;
    case "number":
    case "boolean":
      return String(raw);
    default:
      throw new Error(`expected a string argument, got ${describe(raw)}`);
  }
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/**
 * evalExpression evaluates an arithmetic expression using a recursive-descent
 * parser. It supports + - * / % operators, unary minus, parentheses and
 * floating-point literals, with no external dependencies.
 */
export function evalExpression(input: string): number {
  const parser = new ExprParser(input);
  parser.skipSpaces();
  if (parser.done()) throw new Error("empty expression");
  const value = parser.parseExpr();
  parser.skipSpaces();
  if (!parser.done()) {
    throw new Error(`unexpected character ${JSON.stringify(parser.peek())} at position ${parser.position}`);
  }
  return value;
}

class ExprParser {
  private readonly input: string;
  private pos = 0;

  constructor(input: string) {
    this.input = input;
  }

  get position(): number {
    return this.pos;
  }

  done(): boolean {
    return this.pos >= this.input.length;
  }

  skipSpaces(): void {
    while (this.pos < this.input.length && /\s/.test(this.input[this.pos]!)) this.pos++;
  }

  peek(): string {
    return this.pos < this.input.length ? this.input[this.pos]! : "";
  }

  parseExpr(): number {
    let value = this.parseTerm();
    for (;;) {
      this.skipSpaces();
      const op = this.peek();
      if (op !== "+" && op !== "-") return value;
      this.pos++;
      const right = this.parseTerm();
      value = op === "+" ? value + right : value - right;
    }
  }

  parseTerm(): number {
    let value = this.parseFactor();
    for (;;) {
      this.skipSpaces();
      const op = this.peek();
      if (op !== "*" && op !== "/" && op !== "%") return value;
      this.pos++;
      const right = this.parseFactor();
      if (op === "*") {
        value *= right;
      } else if (op === "/") {
        if (right === 0) throw new Error("division by zero");
        value /= right;
      } else {
        if (right === 0) throw new Error("modulo by zero");
        value %= right;
      }
    }
  }

  parseFactor(): number {
    this.skipSpaces();
    const ch = this.peek();
    if (ch === "+") {
      this.pos++;
      return this.parseFactor();
    }
    if (ch === "-") {
      this.pos++;
      return -this.parseFactor();
    }
    if (ch === "(") {
      this.pos++;
      const value = this.parseExpr();
      this.skipSpaces();
      if (this.peek() !== ")") throw new Error(`expected ')' at position ${this.pos}`);
      this.pos++;
      return value;
    }
    return this.parseNumber();
  }

  parseNumber(): number {
    this.skipSpaces();
    const start = this.pos;
    while (this.pos < this.input.length && /[0-9.]/.test(this.input[this.pos]!)) this.pos++;
    const literal = this.input.slice(start, this.pos).trim();
    if (literal === "") throw new Error(`expected number at position ${start}`);
    const value = Number(literal);
    if (!Number.isFinite(value)) throw new Error(`invalid number ${JSON.stringify(literal)}`);
    return value;
  }
}
