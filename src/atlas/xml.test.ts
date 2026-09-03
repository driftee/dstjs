import { describe, expect, it } from "vitest";

import { parseAtlasXml, safeImageName, uvToRectangle } from "./xml.js";

describe("parseAtlasXml", () => {
  it("pairs each texture with its following elements", () => {
    const sheets = parseAtlasXml(
      '<Atlas><Texture filename="inventory.tex"/><Elements>'
      + '<Element name="twigs.tex" u1="0.25" u2="0.5" v1="0.25" v2="0.75"/>'
      + "</Elements></Atlas>",
    );

    expect(sheets).toEqual([{
      texture: "inventory.tex",
      elements: [{
        name: "twigs.tex",
        u1: 0.25,
        u2: 0.5,
        v1: 0.25,
        v2: 0.75,
      }],
    }]);
  });
});

describe("uvToRectangle", () => {
  it("converts bottom-left UV coordinates to top-left pixels", () => {
    expect(uvToRectangle({
      name: "twigs.tex",
      u1: 0.25,
      u2: 0.5,
      v1: 0.25,
      v2: 0.75,
    }, 100, 80)).toEqual({
      left: 25,
      top: 20,
      width: 25,
      height: 40,
    });
  });

  it("creates safe PNG names", () => {
    expect(safeImageName("inventory/items/twigs.tex")).toBe("inventory__items__twigs.png");
  });
});
