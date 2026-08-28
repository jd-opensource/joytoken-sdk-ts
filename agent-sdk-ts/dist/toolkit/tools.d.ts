import type { AgentTool } from "../types.js";
/**
 * MaxArgBytes caps the length of a single string argument extracted from tool
 * input. It is a coarse guard against a model sending a pathologically large
 * value that would be buffered in memory before a tool's own size checks run.
 */
export declare const MaxArgBytes: number;
/**
 * Calculator returns a zero-dependency, local, side-effect-free tool that
 * evaluates an arithmetic expression. It supports + - * / % and parentheses
 * over floating-point numbers. Because it has no side effects and needs no
 * credentials, it is safe to run under PermissionAuto and is part of the
 * default tool set.
 */
export declare function calculator(): AgentTool;
/**
 * DateTime returns a zero-dependency, local, side-effect-free tool that reports
 * the current date and time. It accepts an optional IANA timezone name (e.g.
 * "Asia/Shanghai"). Because it only reads the clock and needs no credentials,
 * it is safe to run under PermissionAuto and is part of the default tool set.
 */
export declare function dateTime(): AgentTool;
/**
 * stringArg extracts a required string field from a tool's structured input.
 * It accepts strings directly and coerces numbers and booleans to their string
 * form, because models frequently emit e.g. {"expression": 42} instead of
 * {"expression": "42"}. The extracted value is bounded by MaxArgBytes.
 */
export declare function stringArg(input: unknown, key: string): string;
/**
 * optionalStringArg extracts an optional string field from a tool's structured
 * input, returning "" when the field is absent or not a string.
 */
export declare function optionalStringArg(input: unknown, key: string): string;
//# sourceMappingURL=tools.d.ts.map