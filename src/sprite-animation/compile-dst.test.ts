import sharp from "sharp";
import { describe, expect, it } from "vitest";

import type { AnimationBundle, BuildBundle } from "../animation/archive.js";
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

  it("applies AnimState colours to exported sprite assets", async () => {
    const result = await compileDstSpriteAnimation(createBundle(), {
      multColour: [0.5, 1, 1, 1],
      addColour: [0, 0.25, 0, 0],
    });
    const image = result.images.get("3:0");
    if (!image) throw new Error("missing compiled sprite");
    const { data } = await sharp(image).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const alphaOffset = [...data].findIndex((value, index) => index % 4 === 3 && value > 0);
    const pixelOffset = alphaOffset - 3;

    expect([...data.subarray(pixelOffset, pixelOffset + 4)]).toEqual([128, 64, 0, 255]);
  });

  it("resolves missing animation symbols from an external override build", async () => {
    const bundle = createBundle();
    const element = bundle.animation.animations[0]?.frames[0]?.elements[0];
    const source = bundle.build.symbols[0];
    if (!element || !source) throw new Error("missing synthetic animation data");
    element.symbolHash = 99;
    element.symbolName = "swap_meter";
    const overrideBuild: BuildBundle = {
      build: {
        ...bundle.build,
        name: "meter",
        symbols: [{ ...source, hash: 5, name: "10" }],
      },
      atlases: bundle.atlases,
    };

    const result = await compileDstSpriteAnimation(bundle, {
      symbolOverrides: { swap_meter: "10" },
      symbolOverrideBuilds: [overrideBuild],
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

  it("treats empty build frames as transparent animation elements", async () => {
    const bundle = createBundle();
    const symbol = bundle.build.symbols[0];
    if (!symbol) throw new Error("missing synthetic build symbol");
    symbol.frames[0]!.vertices = [];

    const result = await compileDstSpriteAnimation(bundle);

    expect(result.document.assets).toEqual({});
    expect(result.document.clips[0]?.frames[0]?.elements).toEqual([]);
  });

  it("omits animation elements from explicitly hidden layers", async () => {
    const bundle = createBundle();

    const result = await compileDstSpriteAnimation(bundle, {
      hiddenLayers: ["square_layer"],
    });

    expect(result.document.assets).toEqual({});
    expect(result.document.clips[0]?.frames[0]?.elements).toEqual([]);
  });
});
