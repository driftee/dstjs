import { describe, expect, it } from "vitest";

import {
  applyAnimationColourToRgba,
  hasAnimationColourTransform,
  parseAnimationColour,
} from "./colour.js";

describe("animation colour transforms", () => {
  it("parses four SetColour channels", () => {
    expect(parseAnimationColour("0.5, 0.8,1,1", "--mult-colour"))
      .toEqual([0.5, 0.8, 1, 1]);
    expect(() => parseAnimationColour("1,2,3", "--add-colour"))
      .toThrow("--add-colour 应为 4 个逗号分隔的数字");
    expect(() => parseAnimationColour("1,,1,1", "--mult-colour"))
      .toThrow("--mult-colour 应为 4 个非空数字");
  });

  it("applies multiply and additive channels with byte clamping", () => {
    const result = applyAnimationColourToRgba(
      Uint8Array.from([100, 150, 200, 128]),
      {
        multiply: [0.5, 0.8, 1, 0.5],
        add: [0.1, 0, 0.5, 0],
      },
    );

    expect([...result]).toEqual([151, 240, 255, 64]);
  });

  it("keeps transparent pixels transparent and ignores additive alpha", () => {
    const result = applyAnimationColourToRgba(
      Uint8Array.from([0, 0, 0, 0, 100, 150, 200, 128]),
      {
        multiply: [1, 1, 1, 0.5],
        add: [0, 0, 0, 0.25],
      },
    );

    expect([...result]).toEqual([0, 0, 0, 0, 200, 255, 255, 64]);
  });

  it("detects identity transforms", () => {
    expect(hasAnimationColourTransform({})).toBe(false);
    expect(hasAnimationColourTransform({
      multiply: [1, 1, 1, 1],
      add: [0, 0, 0, 0],
    })).toBe(false);
    expect(hasAnimationColourTransform({ add: [0.1, 0, 0, 0] })).toBe(true);
  });
});
