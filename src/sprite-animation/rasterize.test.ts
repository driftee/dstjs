import sharp from "sharp";
import { describe, expect, it } from "vitest";

import type { BuildFrame } from "../animation/types.js";
import type { DecodedKtex } from "../texture/ktex.js";
import { rasterizeBuildFrame } from "./rasterize.js";

describe("rasterizeBuildFrame", () => {
  it("directly composes axis-aligned DST quad meshes", async () => {
    const atlas: DecodedKtex = {
      width: 2,
      height: 2,
      rgba: Uint8Array.from([
        255, 0, 0, 255,
        0, 255, 0, 255,
        0, 0, 255, 255,
        255, 255, 0, 255,
      ]),
      compression: "rgba",
      mipmapCount: 1,
    };
    const frame: BuildFrame = {
      frameNumber: 0,
      duration: 1,
      bounds: { x: 0, y: 0, width: 2, height: 2 },
      alphaIndex: 0,
      alphaCount: 6,
      vertices: [
        { x: -1, y: -1, z: 0, u: 0, v: 1, w: 0 },
        { x: 1, y: -1, z: 0, u: 1, v: 1, w: 0 },
        { x: -1, y: 1, z: 0, u: 0, v: 0, w: 0 },
        { x: 1, y: -1, z: 0, u: 1, v: 1, w: 0 },
        { x: 1, y: 1, z: 0, u: 1, v: 0, w: 0 },
        { x: -1, y: 1, z: 0, u: 0, v: 0, w: 0 },
      ],
    };

    const rendered = await rasterizeBuildFrame(frame, [atlas], 0);
    const pixels = await sharp(rendered.png).raw().toBuffer();

    expect(rendered).toMatchObject({ width: 2, height: 2, originX: 1, originY: 1 });
    expect([...pixels]).toEqual([...atlas.rgba]);
  });

  it("preserves horizontal and vertical flips for axis-aligned quads", async () => {
    const atlas = createAtlas([
      255, 0, 0, 255,
      0, 255, 0, 255,
      0, 0, 255, 255,
      255, 255, 0, 255,
    ]);
    const frame = createQuadFrame([
      { x: 1, y: 1, z: 0, u: 0, v: 1, w: 0 },
      { x: -1, y: 1, z: 0, u: 1, v: 1, w: 0 },
      { x: 1, y: -1, z: 0, u: 0, v: 0, w: 0 },
      { x: -1, y: 1, z: 0, u: 1, v: 1, w: 0 },
      { x: -1, y: -1, z: 0, u: 1, v: 0, w: 0 },
      { x: 1, y: -1, z: 0, u: 0, v: 0, w: 0 },
    ]);

    const rendered = await rasterizeBuildFrame(frame, [atlas], 0);
    const pixels = await sharp(rendered.png).raw().toBuffer();

    expect([...pixels]).toEqual([
      255, 255, 0, 255,
      0, 0, 255, 255,
      0, 255, 0, 255,
      255, 0, 0, 255,
    ]);
  });

  it("composites overlapping translucent quads in source order", async () => {
    const red = createAtlas([255, 0, 0, 128], 1, 1);
    const blue = createAtlas([0, 0, 255, 128], 1, 1);
    const vertices = [
      ...unitQuad(0),
      ...unitQuad(1),
    ];
    const frame: BuildFrame = {
      ...createQuadFrame(vertices),
      bounds: { x: 0, y: 0, width: 1, height: 1 },
    };

    const rendered = await rasterizeBuildFrame(frame, [red, blue], 0);
    const pixels = await sharp(rendered.png).raw().toBuffer();

    expect([...pixels]).toEqual([85, 0, 170, 192]);
  });

  it("does not treat two duplicate triangles as a complete rectangle", async () => {
    const atlas = createAtlas([
      255, 0, 0, 255,
      255, 0, 0, 255,
      255, 0, 0, 255,
      255, 0, 0, 255,
    ]);
    const triangle = [
      { x: -1, y: -1, z: 0, u: 0, v: 1, w: 0 },
      { x: 1, y: -1, z: 0, u: 1, v: 1, w: 0 },
      { x: -1, y: 1, z: 0, u: 0, v: 0, w: 0 },
    ];
    const frame = createQuadFrame([...triangle, ...triangle]);

    const rendered = await rasterizeBuildFrame(frame, [atlas], 0);
    const pixels = await sharp(rendered.png).raw().toBuffer();

    expect(pixels[15]).toBe(0);
  });
});

function createAtlas(
  rgba: number[],
  width = 2,
  height = 2,
): DecodedKtex {
  return {
    width,
    height,
    rgba: Uint8Array.from(rgba),
    compression: "rgba",
    mipmapCount: 1,
  };
}

function createQuadFrame(vertices: BuildFrame["vertices"]): BuildFrame {
  return {
    frameNumber: 0,
    duration: 1,
    bounds: { x: 0, y: 0, width: 2, height: 2 },
    alphaIndex: 0,
    alphaCount: vertices.length,
    vertices,
  };
}

function unitQuad(atlasIndex: number): BuildFrame["vertices"] {
  return [
    { x: -0.5, y: -0.5, z: 0, u: 0, v: 1, w: atlasIndex },
    { x: 0.5, y: -0.5, z: 0, u: 1, v: 1, w: atlasIndex },
    { x: -0.5, y: 0.5, z: 0, u: 0, v: 0, w: atlasIndex },
    { x: 0.5, y: -0.5, z: 0, u: 1, v: 1, w: atlasIndex },
    { x: 0.5, y: 0.5, z: 0, u: 1, v: 0, w: atlasIndex },
    { x: -0.5, y: 0.5, z: 0, u: 0, v: 0, w: atlasIndex },
  ];
}
