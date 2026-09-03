import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { decodeKtex } from "./ktex.js";
import { convertKtexToPng } from "./png.js";
import { createKtex } from "./test-helpers.js";

describe("decodeKtex", () => {
  it("preserves stored ground RGB without changing default sprite unpremultiplication", () => {
    const stored = [64, 100, 32, 64, 180, 200, 160, 255, 10, 20, 30, 0];
    const input = createKtex({ compression: 4, width: 3, height: 1, pitch: 12, pixels: Buffer.from(stored) });
    expect([...decodeKtex(input, { unpremultiplyAlpha: false }).rgba]).toEqual(stored);
    expect([...decodeKtex(input).rgba]).toEqual([255, 255, 128, 64, 180, 200, 160, 255, 10, 20, 30, 0]);
    expect([...decodeKtex(input, { unpremultiplyAlpha: true }).rgba]).toEqual([...decodeKtex(input).rgba]);
  });

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

  it("converts a standalone KTEX texture into PNG", async () => {
    const input = createKtex({
      compression: 4,
      width: 2,
      height: 1,
      pitch: 8,
      pixels: Buffer.from([
        255, 0, 0, 255,
        0, 255, 0, 255,
      ]),
    });

    const result = await convertKtexToPng(input);
    const metadata = await sharp(result.png).metadata();

    expect(result).toMatchObject({
      width: 2,
      height: 1,
      compression: "rgba",
      mipmapCount: 1,
    });
    expect(metadata).toMatchObject({ format: "png", width: 2, height: 1 });
  });
});
