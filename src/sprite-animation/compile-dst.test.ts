import sharp from "sharp";
import { describe, expect, it } from "vitest";

import type { AnimationBundle } from "../animation/archive.js";
import { parseAnimation } from "../animation/parse-animation.js";
import { parseBuild } from "../animation/parse-build.js";
import { createAnimationBinary, createBuildBinary } from "../animation/test-helpers.js";
import { compileDstSpriteAnimation } from "./compile-dst.js";

function createBundle(): AnimationBundle {
  return {
    animation: parseAnimation(createAnimationBinary()),
    build: parseBuild(createBuildBinary()),
    atlases: new Map([["atlas-0.tex", {
      width: 2,
      height: 2,
      rgba: Uint8Array.from([
        255, 0, 0, 255,
        255, 0, 0, 255,
        255, 0, 0, 255,
        255, 0, 0, 255,
      ]),
      compression: "rgba",
      mipmapCount: 1,
    }]]),
  };
}

describe("DST sprite animation compiler", () => {
  it("preserves DST scene semantics in the target-neutral IR", async () => {
    const result = await compileDstSpriteAnimation(createBundle());
    const clip = result.document.clips[0];
    const frame = clip?.frames[0];
    const element = frame?.elements[0];
    const asset = result.document.assets["3:0"];
    const image = result.images.get("3:0");

    expect(result.document).toMatchObject({
      format: "dstjs-sprite-animation",
      version: 1,
      coordinateSystem: {
        xAxis: "right",
        yAxis: "down",
        transform: "affine-2d",
      },
      metadata: {
        sourceFormat: "dst",
        dstBuildName: "test_build",
      },
    });
    expect(clip).toMatchObject({
      id: "dst:1:idle:255",
      name: "idle",
      frameRate: 10,
      durationFrames: 1,
      metadata: {
        dstBankHash: 1,
        dstBankName: "test_bank",
        dstFacing: 255,
      },
    });
    expect(frame).toMatchObject({
      bounds: { x: 0, y: 0, width: 2, height: 2 },
      events: [{ name: "sound", metadata: { dstHash: 2 } }],
    });
    expect(element).toMatchObject({
      spriteId: "3:0",
      layerId: "dst:4",
      layerName: "square_layer",
      transform: {
        matrix: [1, 0, 0, 1, 0, 0],
        channels: {
          position: [0, 0],
          rotation: 0,
          scale: [1, 1],
          skewX: 0,
        },
      },
      z: 0,
    });
    expect(asset).toMatchObject({
      id: "3:0",
      name: "square",
      mimeType: "image/png",
    });
    expect(image).toBeDefined();
    await expect(sharp(image).metadata()).resolves.toMatchObject({ format: "png" });
  });

  it("resolves DST symbol overrides before creating IR assets", async () => {
    const bundle = createBundle();
    const source = bundle.build.symbols[0];
    if (!source) throw new Error("missing synthetic symbol");
    bundle.build.symbols.push({ ...source, hash: 5, name: "pink_square" });

    const result = await compileDstSpriteAnimation(bundle, {
      symbolOverrides: { square: "pink_square" },
    });

    expect(Object.keys(result.document.assets)).toEqual(["5:0"]);
    expect(result.document.clips[0]?.frames[0]?.elements[0]?.spriteId).toBe("5:0");
  });

  it("falls back to the latest sparse build frame", async () => {
    const bundle = createBundle();
    const element = bundle.animation.animations[0]?.frames[0]?.elements[0];
    if (!element) throw new Error("missing synthetic animation element");
    element.buildFrame = 1;

    const result = await compileDstSpriteAnimation(bundle);

    expect(Object.keys(result.document.assets)).toEqual(["3:0"]);
    expect(result.document.clips[0]?.frames[0]?.elements[0]?.spriteId).toBe("3:0");
  });

  it("can skip elements without a usable build frame", async () => {
    const bundle = createBundle();
    const symbol = bundle.build.symbols[0];
    if (!symbol) throw new Error("missing synthetic build symbol");
    symbol.frames[0]!.frameNumber = 2;

    const result = await compileDstSpriteAnimation(bundle, {
      skipMissingSymbols: true,
    });

    expect(result.document.assets).toEqual({});
    expect(result.document.clips[0]?.frames[0]?.elements).toEqual([]);
  });
});
