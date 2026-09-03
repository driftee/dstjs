import { describe, expect, it } from "vitest";

import { parseGameTranslations } from "./translations.js";

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
});
