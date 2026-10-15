import { describe, expect, it } from "vitest";

import {
  ModNameTranslations,
  parseGameTranslations,
  parseModNameAssignments,
} from "./translations.js";

const catalog = `
msgid ""
msgstr ""
"Language: zh\\n"
"Content-Type: text/plain; charset=utf-8\\n"

msgctxt "STRINGS.NAMES.TWIGS"
msgid "Twigs"
msgstr "树枝"

msgctxt "STRINGS.RECIPE_DESC.TWIGS"
msgid "A single twig can make all the difference."
msgstr "小小的树枝也能起大用。"

msgctxt "STRINGS.NAMES.TORCH"
msgid "Torch"
msgstr "火炬"

msgctxt "STRINGS.NAMES.LUNARPLANT_HUSK"
msgid "Brightshade Husk"
msgstr "亮茄外壳"

msgctxt "STRINGS.CHARACTERS.GENERIC.DESCRIBE.TORCH"
msgid "Something to hold back the night."
msgstr "用来抵御夜色。"
`;

describe("game translations", () => {
  const translations = parseGameTranslations(catalog);

  it("resolves an exact Chinese name and description", () => {
    expect(translations.resolve("twigs")).toEqual({
      code: "twigs",
      title: "树枝",
      description: "小小的树枝也能起大用。",
      englishTitle: "Twigs",
      confidence: "EXACT",
    });
  });

  it("does not use character examination dialogue as an item description", () => {
    expect(translations.resolve("torch")).toEqual({
      code: "torch",
      title: "火炬",
      description: "",
      englishTitle: "Torch",
      confidence: "NAME_ONLY",
    });
  });

  it("keeps the code when no translation is available", () => {
    expect(translations.resolve("unknown_item")).toMatchObject({
      code: "unknown_item",
      title: "unknown_item",
      description: "",
      confidence: "UNMATCHED",
    });
  });

  it("resolves an official name with its localization source", () => {
    const sourced = parseGameTranslations(catalog, "/game/data/scripts/languages/chinese_s.po");
    expect(sourced.resolveName("lunarplant_husk")).toEqual({
      code: "lunarplant_husk",
      title: "亮茄外壳",
      englishTitle: "Brightshade Husk",
      key: "STRINGS.NAMES.LUNARPLANT_HUSK",
      source: "/game/data/scripts/languages/chinese_s.po",
      confidence: "EXACT",
      candidates: [{
        title: "亮茄外壳",
        source: "/game/data/scripts/languages/chinese_s.po",
      }],
    });
  });
});

describe("mod name translations", () => {
  it("collects direct, bracketed, conditional, and helper-call literals", () => {
    const parsed = parseModNameAssignments(`
STRINGS.NAMES.DIRECT = "直接名称"
GLOBAL.STRINGS.NAMES["BRACKETED"] = '括号名称'
STRINGS.NAMES.CONDITIONAL = language == 0 and "中文名称" or "English Name"
STRINGS.NAMES.HELPER = S("辅助名称", "Helper Name")
-- STRINGS.NAMES.COMMENTED = "行注释"
--[[
STRINGS.NAMES.BLOCK_COMMENTED = "块注释"
]]
`, "scripts/names.lua");

    expect(parsed.get("DIRECT")).toEqual([{
      title: "直接名称",
      source: "scripts/names.lua:2",
    }]);
    expect(parsed.get("BRACKETED")).toEqual([{
      title: "括号名称",
      source: "scripts/names.lua:3",
    }]);
    expect(parsed.get("CONDITIONAL")?.map(candidate => candidate.title))
      .toEqual(["中文名称", "English Name"]);
    expect(parsed.get("HELPER")?.map(candidate => candidate.title))
      .toEqual(["辅助名称", "Helper Name"]);
    expect(parsed.has("COMMENTED")).toBe(false);
    expect(parsed.has("BLOCK_COMMENTED")).toBe(false);
  });

  it("returns a unique Chinese literal as static evidence", () => {
    const translations = new ModNameTranslations(parseModNameAssignments(`
STRINGS.NAMES.ITEM = language == 0 and "模组物品" or "Mod Item"
`, "modmain.lua"));
    expect(translations.resolveName("item")).toMatchObject({
      code: "item",
      title: "模组物品",
      englishTitle: "Mod Item",
      key: "STRINGS.NAMES.ITEM",
      source: "modmain.lua:2",
      confidence: "STATIC",
    });
  });

  it("does not choose between conflicting Chinese literals", () => {
    const translations = new ModNameTranslations(parseModNameAssignments(`
STRINGS.NAMES.ITEM = "旧名称"
STRINGS.NAMES.ITEM = "新名称"
`, "modmain.lua"));
    expect(translations.resolveName("item")).toMatchObject({
      title: "item",
      confidence: "AMBIGUOUS",
    });
  });

  it("keeps the prefab when no Chinese literal is available", () => {
    const translations = new ModNameTranslations(parseModNameAssignments(
      'STRINGS.NAMES.ITEM = "English Only"',
      "modmain.lua",
    ));
    expect(translations.resolveName("item")).toMatchObject({
      title: "item",
      englishTitle: "English Only",
      confidence: "UNMATCHED",
    });
  });
});
