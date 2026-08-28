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
export function evalExpression(input: string): number {
  const parser = new ExprParser(input);
  parser.skipSpaces();
  if (parser.done()) {
    throw new Error("empty expression");
  }
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
    while (this.pos < this.input.length && /\s/.test(this.input[this.pos]!)) {
      this.pos++;
    }
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
        value = Math.trunc(value) % Math.trunc(right);
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
      if (this.peek() !== ")") {
        throw new Error(`expected ')' at position ${this.pos}`);
      }
      this.pos++;
      return value;
    }
    return this.parseNumber();
  }

  parseNumber(): number {
    this.skipSpaces();
    const start = this.pos;
    while (this.pos < this.input.length && /[0-9.]/.test(this.input[this.pos]!)) {
      this.pos++;
    }
    const literal = this.input.slice(start, this.pos).trim();
    if (literal === "") {
      throw new Error(`expected number at position ${start}`);
    }
    const value = Number(literal);
    if (!Number.isFinite(value)) {
      throw new Error(`invalid number ${JSON.stringify(literal)}`);
    }
    return value;
  }
}