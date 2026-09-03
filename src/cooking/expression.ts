export type CookingExpression =
  | { type: "number"; value: number }
  | { type: "boolean"; value: boolean }
  | { type: "nil" }
  | { type: "reference"; scope: "names" | "tags"; key: string }
  | { type: "unary"; operator: "not" | "-"; operand: CookingExpression }
  | {
      type: "binary";
      operator: "and" | "or" | "+" | "-" | "*" | "/" | "==" | "~=" | ">" | ">=" | "<" | "<=";
      left: CookingExpression;
      right: CookingExpression;
    };

type Token = {
  type: "number" | "identifier" | "operator" | "left" | "right" | "eof";
  value: string;
};

const PRECEDENCE: Readonly<Record<string, number>> = {
  or: 1,
  and: 2,
  "==": 3,
  "~=": 3,
  ">": 3,
  ">=": 3,
  "<": 3,
  "<=": 3,
  "+": 4,
  "-": 4,
  "*": 5,
  "/": 5,
};

export function parseCookingExpression(input: string): CookingExpression {
  const parser = new ExpressionParser(tokenize(input));
  const expression = parser.parse();
  parser.expect("eof");
  return expression;
}

class ExpressionParser {
  private index = 0;

  constructor(private readonly tokens: readonly Token[]) {}

  parse(minimumPrecedence = 0): CookingExpression {
    let left = this.parseUnary();
    while (true) {
      const token = this.current();
      const precedence = token.type === "operator" ? PRECEDENCE[token.value] : undefined;
      if (precedence === undefined || precedence < minimumPrecedence) break;
      this.index += 1;
      const right = this.parse(precedence + 1);
      left = {
        type: "binary",
        operator: token.value as Extract<CookingExpression, { type: "binary" }>["operator"],
        left,
        right,
      };
    }
    return left;
  }

  expect(type: Token["type"], value?: string): Token {
    const token = this.current();
    if (token.type !== type || (value !== undefined && token.value !== value)) {
      throw new Error(`Expected ${value ?? type}, received ${token.value || token.type}`);
    }
    this.index += 1;
    return token;
  }

  private parseUnary(): CookingExpression {
    const token = this.current();
    if (token.type === "operator" && (token.value === "not" || token.value === "-")) {
      this.index += 1;
      return { type: "unary", operator: token.value, operand: this.parseUnary() };
    }
    if (token.type === "left") {
      this.index += 1;
      const expression = this.parse();
      this.expect("right");
      return expression;
    }
    if (token.type === "number") {
      this.index += 1;
      return { type: "number", value: Number(token.value) };
    }
    if (token.type === "identifier") {
      this.index += 1;
      if (token.value === "true" || token.value === "false") {
        return { type: "boolean", value: token.value === "true" };
      }
      if (token.value === "nil") return { type: "nil" };
      const match = /^(names|tags)\.([A-Za-z0-9_]+)$/.exec(token.value);
      if (!match) throw new Error(`Unsupported cooking reference: ${token.value}`);
      return { type: "reference", scope: match[1] as "names" | "tags", key: match[2]! };
    }
    throw new Error(`Unexpected cooking expression token: ${token.value || token.type}`);
  }

  private current(): Token {
    return this.tokens[this.index] ?? { type: "eof", value: "" };
  }
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < input.length) {
    const character = input[index]!;
    if (/\s/.test(character)) {
      index += 1;
      continue;
    }
    if (character === "-" && input[index + 1] === "-") {
      const newline = input.indexOf("\n", index + 2);
      index = newline < 0 ? input.length : newline + 1;
      continue;
    }
    if (character === "(" || character === ")") {
      tokens.push({ type: character === "(" ? "left" : "right", value: character });
      index += 1;
      continue;
    }
    const operator = /^(>=|<=|==|~=|[+\-*/<>])/.exec(input.slice(index));
    if (operator) {
      tokens.push({ type: "operator", value: operator[1]! });
      index += operator[1]!.length;
      continue;
    }
    const number = /^(?:\d+(?:\.\d*)?|\.\d+)/.exec(input.slice(index));
    if (number) {
      tokens.push({ type: "number", value: number[0] });
      index += number[0].length;
      continue;
    }
    const identifier = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(input.slice(index));
    if (identifier) {
      const value = identifier[0];
      tokens.push({
        type: value === "and" || value === "or" || value === "not" ? "operator" : "identifier",
        value,
      });
      index += value.length;
      continue;
    }
    throw new Error(`Unsupported cooking expression near: ${input.slice(index, index + 24)}`);
  }
  tokens.push({ type: "eof", value: "" });
  return tokens;
}
