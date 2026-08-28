/**
 * evalExpression evaluates an arithmetic expression using a recursive-descent
 * parser. It supports + - * / % operators, unary minus, parentheses and
 * floating-point literals, with no external dependencies.
 *
 * Grammar:
 *   expr   = term { ("+" | "-") term }
 *   term   = factor { ("*" | "/" | "%") factor }
 *   factor = number | "(" expr ")" | ("+" | "-") factor
 */
export declare function evalExpression(input: string): number;
//# sourceMappingURL=eval.d.ts.map