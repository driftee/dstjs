import { describe, expect, it } from "vitest";

import { decodeKtex } from "./ktex.js";
import { createKtex } from "./test-helpers.js";

describe("decodeKtex", () => {
  it("reads RGBA pixels and converts the bottom-up texture to top-down", () => {
    const topLeft = [255, 0, 0, 255];
    const topRight = [0, 255, 0, 255];
    const bottomLeft = [0, 0, 255, 255];
    const bottomRight = [255, 255, 255, 255];
    const storedPixels = Buffer.from([
      ...bottomLeft,
      ...bottomRight,
      ...topLeft,
      ...topRight,
    ]);
    const input = createKtex({
      compression: 4,
      width: 2,
      height: 2,
      pitch: 8,
      pixels: storedPixels,
    });

    const result = decodeKtex(input);

    expect(result).toMatchObject({
      width: 2,
      height: 2,
      compression: "rgba",
      mipmapCount: 1,
    });
    expect([...result.rgba]).toEqual([
      ...topLeft,
      ...topRight,
      ...bottomLeft,
      ...bottomRight,
    ]);
  });

  it("rejects malformed mipmap data", () => {
    const input = createKtex({
      compression: 4,
      width: 2,
      height: 2,
      pitch: 8,
      pixels: Buffer.alloc(4),
      declaredSize: 16,
    });

    expect(() => decodeKtex(input)).toThrow("像素数据不完整");
  });
});
