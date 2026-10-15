import sharp from "sharp";
import { describe, expect, it } from "vitest";

import type { WebAnimationPackage } from "./types.js";
import { composeWebAnimations } from "./compose.js";

describe("Web animation composition", () => {
  it("combines synchronized clips, atlases, sprite ids, and layer offsets", async () => {
    const left = await packageWithPixel([255, 0, 0, 255]);
    const right = await packageWithPixel([0, 0, 255, 255]);

    const result = await composeWebAnimations([
      {
        package: left,
        animation: "idle",
        prefix: "left",
        offsetX: -20,
        offsetY: -10,
      },
      {
        package: right,
        animation: "idle",
        prefix: "right",
        offsetX: 30,
        offsetY: 15,
      },
    ], { animationName: "together" });

    expect(result.manifest.atlas).toEqual({
      file: "atlas.webp",
      width: 2,
      height: 1,
    });
    expect(result.manifest.sprites).toEqual({
      "left/pixel": {
        x: 0, y: 0, width: 1, height: 1, originX: 0, originY: 0,
      },
      "right/pixel": {
        x: 1, y: 0, width: 1, height: 1, originX: 0, originY: 0,
      },
    });
    expect(result.manifest.animations.together?.frames[0]?.elements).toEqual([
      { sprite: "left/pixel", transform: [1, 0, 0, 1, -20, -10], z: 0 },
      { sprite: "right/pixel", transform: [1, 0, 0, 1, 30, 15], z: 0 },
    ]);
    const { data, info } = await sharp(result.atlas).ensureAlpha().raw()
      .toBuffer({ resolveWithObject: true });
    expect(info).toMatchObject({ width: 2, height: 1, channels: 4 });
    expect([...data]).toEqual([255, 0, 0, 255, 0, 0, 255, 255]);
  });

  it("rejects mismatched frame timing and duplicate prefixes", async () => {
    const package_ = await packageWithPixel([255, 255, 255, 255]);
    const slower = structuredClone(package_);
    slower.manifest.animations.idle!.frameRate = 15;

    await expect(composeWebAnimations([
      { package: package_, animation: "idle", prefix: "first" },
      { package: slower, animation: "idle", prefix: "second" },
    ])).rejects.toThrow("帧率或帧数");
    await expect(composeWebAnimations([
      { package: package_, animation: "idle", prefix: "same" },
      { package: package_, animation: "idle", prefix: "same" },
    ])).rejects.toThrow("prefix 重复");
  });
});

async function packageWithPixel(rgba: [number, number, number, number]): Promise<WebAnimationPackage> {
  return {
    manifest: {
      format: "dstjs-web-animation",
      version: 1,
      atlas: { file: "atlas.webp", width: 1, height: 1 },
      sprites: {
        pixel: {
          x: 0, y: 0, width: 1, height: 1, originX: 0, originY: 0,
        },
      },
      animations: {
        idle: {
          frameRate: 30,
          duration: 1 / 30,
          frames: [{
            elements: [{
              sprite: "pixel",
              transform: [1, 0, 0, 1, 0, 0],
              z: 0,
            }],
          }],
        },
      },
    },
    atlas: await sharp(Uint8Array.from(rgba), {
      raw: { width: 1, height: 1, channels: 4 },
    }).webp({ lossless: true }).toBuffer(),
  };
}
