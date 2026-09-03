import { describe, expect, it } from "vitest";

import { parseCookingExpression } from "./expression.js";

describe("cooking expression parser", () => {
  it("parses Lua truth checks, arithmetic and comparisons without executing Lua", () => {
    expect(parseCookingExpression(
      "((names.kelp or 0) + (names.kelp_cooked or 0)) == 2 and not tags.meat",
    )).toMatchObject({
      type: "binary",
      operator: "and",
      left: { type: "binary", operator: "==" },
      right: { type: "unary", operator: "not" },
    });
  });

  it("rejects function calls and unknown globals", () => {
    expect(() => parseCookingExpression("os.execute('bad')")).toThrow("Unsupported cooking expression");
  });
});
