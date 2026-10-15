import sharp from "sharp";
import { describe, expect, it } from "vitest";

import type { AnimationBundle, BuildBundle } from "./archive.js";
import { parseAnimation } from "./parse-animation.js";
import { parseBuild } from "./parse-build.js";
import {
  animationBounds,
  renderAnimationFrame,
  renderAnimationGif,
  sortAnimationElementsForDraw,
} from "./render.js";
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

  it("skips DST animation elements whose complete transform is NaN", () => {
    const input = createAnimationBinary();
    const sentinelOffset = 85;
    for (let index = 0; index < 6; index += 1) input.writeFloatLE(Number.NaN, sentinelOffset + index * 4);

    const result = parseAnimation(input);

    expect(result.animations[0]?.frames[0]?.elements).toEqual([]);
  });

  it("rejects partially invalid DST animation transforms", () => {
    const input = createAnimationBinary();
    input.writeFloatLE(Number.NaN, 85);

    expect(() => parseAnimation(input)).toThrow(/不完整的无效变换/);
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

  it("crops a rendered frame to its non-transparent content", async () => {
    const animation = parseAnimation(createAnimationBinary());
    const frame = animation.animations[0]?.frames[0];
    if (!frame) throw new Error("missing synthetic animation frame");
    frame.bounds = { x: 0, y: 0, width: 10, height: 12 };
    const bundle: AnimationBundle = {
      animation,
      build: parseBuild(createBuildBinary()),
      atlases: new Map([["atlas-0.tex", {
        width: 2,
        height: 2,
        rgba: new Uint8Array(16).fill(255),
        compression: "rgba",
        mipmapCount: 1,
      }]]),
    };

    const result = await renderAnimationFrame(bundle, {
      animation: "idle",
      frameIndex: 0,
      padding: 0,
      cropContent: true,
    });

    expect(result).toMatchObject({ width: 2, height: 2 });
    await expect(sharp(result.png).metadata()).resolves.toMatchObject({ width: 2, height: 2 });
  });

  it("hides explicitly named build symbols from rendered frames", async () => {
    const bundle: AnimationBundle = {
      animation: parseAnimation(createAnimationBinary()),
      build: parseBuild(createBuildBinary()),
      atlases: new Map([["atlas-0.tex", {
        width: 2,
        height: 2,
        rgba: new Uint8Array(16).fill(255),
        compression: "rgba",
        mipmapCount: 1,
      }]]),
    };

    const result = await renderAnimationFrame(bundle, {
      animation: "idle",
      frameIndex: 0,
      hiddenSymbols: ["square"],
    });
    const { data } = await sharp(result.png).ensureAlpha().raw()
      .toBuffer({ resolveWithObject: true });

    expect([...data].filter((_, index) => index % 4 === 3)).toEqual(
      Array(data.length / 4).fill(0),
    );
  });

  it("matches hidden animation layers without case sensitivity", async () => {
    const bundle: AnimationBundle = {
      animation: parseAnimation(createAnimationBinary()),
      build: parseBuild(createBuildBinary()),
      atlases: new Map([["atlas-0.tex", {
        width: 2,
        height: 2,
        rgba: new Uint8Array(16).fill(255),
        compression: "rgba",
        mipmapCount: 1,
      }]]),
    };

    const result = await renderAnimationFrame(bundle, {
      animation: "idle",
      frameIndex: 0,
      hiddenLayers: ["SQUARE_LAYER"],
    });
    const { data } = await sharp(result.png).ensureAlpha().raw()
      .toBuffer({ resolveWithObject: true });

    expect([...data].filter((_, index) => index % 4 === 3)).toEqual(
      Array(data.length / 4).fill(0),
    );
  });

  it("applies AnimState multiply and additive colours to rendered frames", async () => {
    const bundle: AnimationBundle = {
      animation: parseAnimation(createAnimationBinary()),
      build: parseBuild(createBuildBinary()),
      atlases: new Map([["atlas-0.tex", {
        width: 2,
        height: 2,
        rgba: new Uint8Array(16).fill(255),
        compression: "rgba",
        mipmapCount: 1,
      }]]),
    };

    const result = await renderAnimationFrame(bundle, {
      animation: "idle",
      frameIndex: 0,
      padding: 0,
      multColour: [0.5, 0.25, 0, 0.5],
      addColour: [0.1, 0.2, 0.3, 0],
    });
    const { data } = await sharp(result.png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const visible = [...data].findIndex((value, index) => index % 4 === 3 && value > 0);
    const offset = visible - 3;

    expect([...data.subarray(offset, offset + 4)]).toEqual([255, 229, 151, 128]);
  });

  it("applies alpha colour transforms before overlapping elements are composited", async () => {
    const animation = parseAnimation(createAnimationBinary());
    const frame = animation.animations[0]?.frames[0];
    const element = frame?.elements[0];
    if (!frame || !element) throw new Error("missing synthetic animation element");
    frame.elements.push({ ...element, z: element.z + 1 });
    const bundle: AnimationBundle = {
      animation,
      build: parseBuild(createBuildBinary()),
      atlases: new Map([["atlas-0.tex", {
        width: 2,
        height: 2,
        rgba: new Uint8Array(16).fill(255),
        compression: "rgba",
        mipmapCount: 1,
      }]]),
    };

    const result = await renderAnimationFrame(bundle, {
      animation: "idle",
      frameIndex: 0,
      padding: 0,
      multColour: [1, 1, 1, 0.5],
    });
    const { data } = await sharp(result.png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const alpha = [...data].find((value, index) => index % 4 === 3 && value > 0);

    expect(alpha).toBeGreaterThan(180);
    expect(alpha).toBeLessThan(200);
  });

  it("can skip animation elements whose build frame is absent", async () => {
    const animation = parseAnimation(createAnimationBinary());
    const build = parseBuild(createBuildBinary());
    const symbol = build.symbols[0];
    if (!symbol) throw new Error("missing synthetic symbol");
    symbol.frames = [];
    const bundle: AnimationBundle = {
      animation,
      build,
      atlases: new Map([["atlas-0.tex", {
        width: 2,
        height: 2,
        rgba: new Uint8Array(16).fill(255),
        compression: "rgba",
        mipmapCount: 1,
      }]]),
    };

    await expect(renderAnimationFrame(bundle, {
      animation: "idle",
      frameIndex: 0,
      skipMissingSymbols: true,
    })).resolves.toMatchObject({ width: 6, height: 6 });
    await expect(renderAnimationFrame(bundle, {
      animation: "idle",
      frameIndex: 0,
    })).rejects.toThrow(/不包含 build frame 0/);
  });

  it("falls back to the most recent sparse build frame", async () => {
    const animation = parseAnimation(createAnimationBinary());
    const element = animation.animations[0]?.frames[0]?.elements[0];
    const build = parseBuild(createBuildBinary());
    const symbol = build.symbols[0];
    const first = symbol?.frames[0];
    if (!element || !symbol || !first) throw new Error("missing synthetic frame");
    element.buildFrame = 5;
    symbol.frames = [
      { ...first, frameNumber: 0, duration: 1 },
      { ...first, frameNumber: 10, duration: 1 },
    ];

    await expect(renderAnimationFrame({
      animation,
      build,
      atlases: new Map([["atlas-0.tex", {
        width: 2,
        height: 2,
        rgba: new Uint8Array(16).fill(255),
        compression: "rgba",
        mipmapCount: 1,
      }]]),
    }, {
      animation: "idle",
      frameIndex: 0,
      padding: 0,
    })).resolves.toMatchObject({ width: 2, height: 2 });
  });

  it("rejects animation output dimensions beyond the render limit", async () => {
    const animation = parseAnimation(createAnimationBinary());
    const frame = animation.animations[0]?.frames[0];
    if (!frame) throw new Error("missing synthetic frame");
    frame.bounds.width = 8_193;

    await expect(renderAnimationFrame({
      animation,
      build: parseBuild(createBuildBinary()),
      atlases: new Map(),
    }, {
      animation: "idle",
      frameIndex: 0,
      padding: 0,
    })).rejects.toThrow(/动画输出尺寸 8193x2 超过限制/);
  });

  it("renders an added build symbol even when the base build omits it", async () => {
    const animation = parseAnimation(createAnimationBinary());
    const element = animation.animations[0]?.frames[0]?.elements[0];
    if (!element) throw new Error("missing synthetic element");
    element.symbolHash = 99;
    element.symbolName = "snow";

    const baseBuild = parseBuild(createBuildBinary());
    const overrideBuild = parseBuild(createBuildBinary());
    const overrideSymbol = overrideBuild.symbols[0];
    if (!overrideSymbol) throw new Error("missing synthetic override symbol");
    overrideSymbol.hash = 99;
    overrideSymbol.name = "snow";

    const atlas = {
      width: 2,
      height: 2,
      rgba: new Uint8Array(16).fill(255),
      compression: "rgba" as const,
      mipmapCount: 1,
    };
    const bundle: AnimationBundle = {
      animation,
      build: baseBuild,
      atlases: new Map([["atlas-0.tex", atlas]]),
    };
    const snowBuild: BuildBundle = {
      build: overrideBuild,
      atlases: new Map([["atlas-0.tex", atlas]]),
    };

    const rendered = await renderAnimationFrame(bundle, {
      animation: "idle",
      frameIndex: 0,
      symbolOverrideBuilds: [snowBuild],
      padding: 0,
    });
    const { data } = await sharp(rendered.png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

    expect([...data].some((value, index) => index % 4 === 3 && value > 0)).toBe(true);
  });

  it("renders a synthetic animation clip to GIF", async () => {
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

    const result = await renderAnimationGif(bundle, {
      animation: "idle",
      padding: 0,
      scale: 2,
    });
    const metadata = await sharp(result.gif, { animated: true }).metadata();

    expect(result).toMatchObject({ width: 4, height: 4, frames: 1, delay: 100 });
    expect(metadata).toMatchObject({ format: "gif", width: 4, height: 4, pages: 1 });
  });

  it("selects a duplicate animation clip by facing", async () => {
    const animation = parseAnimation(createAnimationBinary());
    const base = animation.animations[0];
    if (!base) throw new Error("missing synthetic animation");
    animation.animations.push({ ...base, facing: 2 });
    const bundle: AnimationBundle = {
      animation,
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

    await expect(renderAnimationGif(bundle, { animation: "idle" })).rejects.toThrow("不唯一");

    const result = await renderAnimationGif(bundle, {
      animation: "idle",
      facing: 2,
      padding: 0,
    });

    expect(result.animation.facing).toBe(2);
  });

  it("keeps negative animation Y above the origin without flipping symbol pixels", async () => {
    const animation = parseAnimation(createAnimationBinary());
    const frame = animation.animations[0]?.frames[0];
    const element = frame?.elements[0];
    if (!frame || !element) throw new Error("missing synthetic frame");
    frame.bounds = { x: 0, y: 0, width: 2, height: 6 };
    element.transform.ty = -2;
    const bundle: AnimationBundle = {
      animation,
      build: parseBuild(createBuildBinary()),
      atlases: new Map([["atlas-0.tex", {
        width: 2,
        height: 2,
        rgba: Uint8Array.from([
          255, 0, 0, 255,
          255, 0, 0, 255,
          0, 0, 255, 255,
          0, 0, 255, 255,
        ]),
        compression: "rgba",
        mipmapCount: 1,
      }]]),
    };

    const rendered = await renderAnimationFrame(bundle, {
      animation: "idle",
      frameIndex: 0,
      padding: 0,
    });
    const { data, info } = await sharp(rendered.png).raw().toBuffer({ resolveWithObject: true });
    const pixel = (x: number, y: number) => [...data.subarray((y * info.width + x) * 4, (y * info.width + x + 1) * 4)];

    expect(pixel(0, 0)[3]).toBeGreaterThan(0);
    expect(pixel(0, 1)[3]).toBeGreaterThan(0);
    expect(pixel(0, 5)[3]).toBe(0);
  });

  it("maps ANIM b/c coefficients to the SVG matrix without transposing rotation", async () => {
    const animation = parseAnimation(createAnimationBinary());
    const frame = animation.animations[0]?.frames[0];
    const element = frame?.elements[0];
    if (!frame || !element) throw new Error("missing synthetic frame");
    element.transform = { a: 0, b: 1, c: -1, d: 0, tx: 0, ty: 0 };
    const bundle: AnimationBundle = {
      animation,
      build: parseBuild(createBuildBinary()),
      atlases: new Map([["atlas-0.tex", {
        width: 2,
        height: 2,
        rgba: Uint8Array.from([
          255, 0, 0, 255,
          255, 0, 0, 255,
          0, 0, 255, 255,
          0, 0, 255, 255,
        ]),
        compression: "rgba",
        mipmapCount: 1,
      }]]),
    };

    const rendered = await renderAnimationFrame(bundle, {
      animation: "idle",
      frameIndex: 0,
      padding: 0,
    });
    const { data, info } = await sharp(rendered.png).raw().toBuffer({ resolveWithObject: true });
    const pixel = (x: number, y: number) => [...data.subarray((y * info.width + x) * 4, (y * info.width + x + 1) * 4)];

    expect(pixel(0, 0)[3]).toBeGreaterThan(0);
    expect(pixel(1, 0)[3]).toBeGreaterThan(0);
    expect([...data].filter((value, index) => index % 4 === 3 && value > 0)).toHaveLength(4);
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

  it("draws higher z elements first so lower z elements remain in front", () => {
    const element = parseAnimation(createAnimationBinary()).animations[0]?.frames[0]?.elements[0];
    if (!element) throw new Error("missing synthetic element");
    const ordered = sortAnimationElementsForDraw([
      { ...element, z: -2 },
      { ...element, z: 4 },
      { ...element, z: 1 },
    ]);

    expect(ordered.map(item => item.z)).toEqual([4, 1, -2]);
  });
});
