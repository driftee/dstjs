import sharp from "sharp";
import { describe, expect, it } from "vitest";

import type { AnimationBundle } from "./archive.js";
import { parseAnimation } from "./parse-animation.js";
import { parseBuild } from "./parse-build.js";
import { animationBounds, renderAnimationFrame } from "./render.js";
import { createAnimationBinary, createBuildBinary } from "./test-helpers.js";

describe("DST animation binaries", () => {
  it("parses ANIM v4 names, frames, events, and transforms", () => {
    const result = parseAnimation(createAnimationBinary());

    expect(result.version).toBe(4);
    expect(result.animations[0]).toMatchObject({
      name: "idle",
      bankName: "test_bank",
      facing: 255,
      frameRate: 10,
    });
    expect(result.animations[0]?.frames[0]?.events[0]).toEqual({ hash: 2, name: "sound" });
    expect(result.animations[0]?.frames[0]?.elements[0]).toMatchObject({
      symbolName: "square",
      layerName: "square_layer",
      buildFrame: 0,
      transform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
    });
  });

  it("parses BILD v6 symbols, frames, and vertices", () => {
    const result = parseBuild(createBuildBinary());

    expect(result).toMatchObject({
      version: 6,
      name: "test_build",
      atlases: ["atlas-0.tex"],
    });
    expect(result.symbols[0]).toMatchObject({ hash: 3, name: "square" });
    expect(result.symbols[0]?.frames[0]).toMatchObject({
      frameNumber: 0,
      duration: 1,
      alphaIndex: 0,
      alphaCount: 6,
    });
    expect(result.vertices).toHaveLength(6);
  });

  it("renders a synthetic animation frame to PNG", async () => {
    const bundle: AnimationBundle = {
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

    const result = await renderAnimationFrame(bundle, {
      animation: "idle",
      frameIndex: 0,
      padding: 0,
      scale: 2,
    });
    const { data, info } = await sharp(result.png).raw().toBuffer({ resolveWithObject: true });

    expect(result).toMatchObject({ width: 4, height: 4, frameIndex: 0 });
    expect(info).toMatchObject({ width: 4, height: 4, channels: 4 });
    expect([...data]).toContain(255);
    expect([...data].filter((_, index) => index % 4 === 3).some((alpha) => alpha > 0)).toBe(true);
  });

  it("computes stable bounds for a frame sequence", () => {
    const animation = parseAnimation(createAnimationBinary()).animations[0];
    if (!animation) throw new Error("missing synthetic animation");
    animation.frames.push({
      bounds: { x: 2, y: -1, width: 4, height: 2 },
      events: [],
      elements: [],
    });

    expect(animationBounds(animation)).toEqual({
      x: 1.5,
      y: -0.5,
      width: 5,
      height: 3,
    });
  });
});
