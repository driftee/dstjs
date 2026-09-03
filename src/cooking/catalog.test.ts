import { describe, expect, it } from "vitest";

import { parseIngredients, parseRecipes } from "./catalog.js";

describe("cooking catalog parser", () => {
  it("expands cooked and dried ingredients while preserving explicit nonfood tags", () => {
    const ingredients = parseIngredients(`
      local meats = {"meat"}
      AddIngredientValues(meats, {meat=1}, true, true)
      AddIngredientValues({"twigs"}, {inedible=1})
      AddIngredientValues({"nightmarefuel"}, {inedible=1, magic=1})
    `);
    expect(ingredients.get("meat_cooked")).toEqual({ precook: 1, meat: 1 });
    expect(ingredients.get("meat_dried")).toEqual({ dried: 1, meat: 1 });
    expect(ingredients.get("nightmarefuel")).toEqual({ inedible: 1, magic: 1 });
  });

  it("parses recipe priority, weight and condition AST", () => {
    const recipes = parseRecipes(`
      local foods = {
        fishsticks = {
          test = function(cooker, names, tags) return tags.fish and names.twigs end,
          priority = 10,
          health = TUNING.HEALING_LARGE,
          hunger = 37.5,
          perishtime = nil,
          cooktime = 2,
        },
      }
    `, "vanilla", ["cookpot", "portablecookpot"], new Map([["HEALING_LARGE", 40]]), 20);
    expect(recipes[0]).toMatchObject({
      id: "fishsticks",
      priority: 10,
      weight: 1,
      health: 40,
      hunger: 37.5,
      perishSeconds: null,
      cookSeconds: 40,
      example: null,
      condition: { type: "binary", operator: "and" },
    });
  });
});
