import type { AgentTool } from "../types.js";
import { defineTool } from "../tools.js";
import { evalExpression } from "./eval.js";

/**
 * MaxArgBytes caps the length of a single string argument extracted from tool
 * input. It is a coarse guard against a model sending a pathologically large
 * value that would be buffered in memory before a tool's own size checks run.
 */
export const MaxArgBytes = 1 << 20; // 1 MiB

/**
 * Calculator returns a zero-dependency, local, side-effect-free tool that
 * evaluates an arithmetic expression. It supports + - * / % and parentheses
 * over floating-point numbers. Because it has no side effects and needs no
 * credentials, it is safe to run under PermissionAuto and is part of the
 * default tool set.
 */
export function calculator(): AgentTool {
  return defineTool({
    name: "calculator",
    description:
      'Evaluate a math expression. Supports + - * / %, parentheses and decimals, e.g. "(2 + 3) * 4.5".',
    parameters: {
      type: "object",
      properties: {
        expression: {
          type: "string",
          description: "The arithmetic expression to evaluate.",
        },
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
 * DateTime returns a zero-dependency, local, side-effect-free tool that reports
 * the current date and time. It accepts an optional IANA timezone name (e.g.
 * "Asia/Shanghai"). Because it only reads the clock and needs no credentials,
 * it is safe to run under PermissionAuto and is part of the default tool set.
 */
export function dateTime(): AgentTool {
  return defineTool({
    name: "datetime",
    description:
      'Get the current date and time. Optionally specify an IANA timezone (e.g. "Asia/Shanghai"). Defaults to UTC.',
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
      return {
        datetime: formatted,
        timezone,
        unix: Math.floor(now.getTime() / 1000),
      };
    },
  });
}

/**
 * stringArg extracts a required string field from a tool's structured input.
 * It accepts strings directly and coerces numbers and booleans to their string
 * form, because models frequently emit e.g. {"expression": 42} instead of
 * {"expression": "42"}. The extracted value is bounded by MaxArgBytes.
 */
export function stringArg(input: unknown, key: string): string {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error(`expected object input, got ${describe(input)}`);
  }
  const object = input as Record<string, unknown>;
  if (!(key in object)) {
    throw new Error(`missing required argument ${JSON.stringify(key)}`);
  }
  const value = coerceString(object[key], key);
  if (value.length > MaxArgBytes) {
    throw new Error(`argument ${JSON.stringify(key)} is ${value.length} bytes, exceeds limit of ${MaxArgBytes}`);
  }
  return value;
}

/**
 * optionalStringArg extracts an optional string field from a tool's structured
 * input, returning "" when the field is absent or not a string.
 */
export function optionalStringArg(input: unknown, key: string): string {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return "";
  }
  const raw = (input as Record<string, unknown>)[key];
  return typeof raw === "string" ? raw : "";
}

/**
 * coerceString converts a scalar into a string. Objects, arrays, null and
 * undefined are rejected because no tool expects a structured value where a
 * string argument is required.
 */
function coerceString(raw: unknown, key: string): string {
  switch (typeof raw) {
    case "string":
      return raw;
    case "boolean":
      return String(raw);
    case "number":
      if (!Number.isFinite(raw)) {
        throw new Error(`argument ${JSON.stringify(key)} must be a finite number`);
      }
      return String(raw);
    default:
      throw new Error(`argument ${JSON.stringify(key)} must be a string, got ${describe(raw)}`);
  }
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}