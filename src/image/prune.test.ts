import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { findAlphaBoundingBox, pruneTransparentImage, resolvePadding } from "./prune.js";

describe("pruneTransparentImage", () => {
  it("crops a PNG to the smallest non-transparent box", async () => {
    const input = await rgbaPng(5, 4, [
      [2, 1, 255],
      [3, 1, 255],
      [2, 2, 255],
      [3, 2, 255],
    ]);

    const result = await pruneTransparentImage(input);
    const { data, info } = await sharp(result.image).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

    expect(result).toMatchObject({
      width: 2,
      height: 2,
      inputWidth: 5,
      inputHeight: 4,
      boundingBox: { left: 2, top: 1, width: 2, height: 2 },
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      pruned: true,
    });
    expect(info).toMatchObject({ width: 2, height: 2, channels: 4 });
    expect([...data].filter((value, index) => index % 4 === 3 && value > 0)).toHaveLength(4);
  });

  it("adds independent padding after cropping", async () => {
    const input = await rgbaPng(4, 4, [[1, 1, 255]]);

    const result = await pruneTransparentImage(input, {
      padding: { top: 1, right: 2, bottom: 3, left: 4 },
    });
    const { data, info } = await sharp(result.image).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const pixel = (x: number, y: number) => data[(y * info.width + x) * 4 + 3] ?? 0;

    expect(result).toMatchObject({
      width: 7,
      height: 5,
      boundingBox: { left: 1, top: 1, width: 1, height: 1 },
    });
    expect(pixel(4, 1)).toBe(255);
    expect(pixel(0, 0)).toBe(0);
    expect(pixel(6, 4)).toBe(0);
  });

  it("keeps an all-transparent image at its original size", async () => {
    const input = await rgbaPng(3, 2, []);

    const result = await pruneTransparentImage(input, { padding: 8 });
    const metadata = await sharp(result.image).metadata();

    expect(result).toMatchObject({
      width: 3,
      height: 2,
      boundingBox: null,
      pruned: false,
    });
    expect(metadata).toMatchObject({ width: 3, height: 2 });
  });
});

describe("findAlphaBoundingBox", () => {
  it("combines visible pixels across animation pages", () => {
    const frameSize = 3 * 3 * 4;
    const rgba = new Uint8Array(frameSize * 2);
    rgba[(0 * 3 + 1) * 4 + 3] = 255;
    rgba[frameSize + (2 * 3 + 2) * 4 + 3] = 255;

    expect(findAlphaBoundingBox(rgba, 3, 3, 2)).toEqual({
      left: 1,
      top: 0,
      width: 2,
      height: 3,
    });
  });
});

describe("resolvePadding", () => {
  it("accepts a shared number or individual sides", () => {
    expect(resolvePadding(2)).toEqual({ top: 2, right: 2, bottom: 2, left: 2 });
    expect(resolvePadding({ top: 1, bottom: 3 })).toEqual({ top: 1, right: 0, bottom: 3, left: 0 });
  });
});

async function rgbaPng(width: number, height: number, visible: Array<[number, number, number]>): Promise<Buffer> {
  const rgba = new Uint8Array(width * height * 4);
  for (const [x, y, alpha] of visible) {
    const offset = (y * width + x) * 4;
    rgba[offset] = 255;
    rgba[offset + 1] = 64;
    rgba[offset + 2] = 32;
    rgba[offset + 3] = alpha;
  }
  return sharp(rgba, { raw: { width, height, channels: 4 } }).png().toBuffer();
}
