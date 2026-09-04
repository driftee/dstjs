import { describe, expect, it } from "vitest";

import {
  createSpriteAnimationTransform,
  type SpriteAnimationMatrix,
  type SpriteAnimationPackage,
} from "../sprite-animation/index.js";
import { compileLottieAnimation, compileLottiePackage } from "./compile.js";

function createPackage(
  transform: SpriteAnimationMatrix = [1, 0, 0, 1, 4, 6],
): SpriteAnimationPackage {
  return {
    document: {
      format: "dstjs-sprite-animation",
      version: 1,
      coordinateSystem: {
        xAxis: "right",
        yAxis: "down",
        transform: "affine-2d",
      },
      assets: {
        body: {
          id: "body",
          name: "body",
          width: 8,
          height: 6,
          originX: 4,
          originY: 3,
          mimeType: "image/png",
        },
      },
      clips: [{
        id: "idle",
        name: "idle",
        frameRate: 10,
        durationFrames: 1,
        frames: [{
          bounds: { x: 4, y: 6, width: 8, height: 6 },
          events: [{ name: "step" }],
          elements: [{
            spriteId: "body",
            layerId: "body",
            layerName: "Body",
            transform: createSpriteAnimationTransform(transform),
            z: 0,
          }],
        }],
      }],
    },
    images: new Map([["body", Buffer.from("png")]]),
  };
}

function createAnimatedPackage(
  transforms: SpriteAnimationMatrix[],
): SpriteAnimationPackage {
  const animationPackage = createPackage(transforms[0]);
  const clip = animationPackage.document.clips[0];
  const firstFrame = clip?.frames[0];
  const firstElement = firstFrame?.elements[0];
  if (!clip || !firstFrame || !firstElement) throw new Error("missing synthetic animation");
  clip.durationFrames = transforms.length;
  clip.frames = transforms.map((transform) => ({
    ...firstFrame,
    elements: [{ ...firstElement, transform: createSpriteAnimationTransform(transform) }],
  }));
  return animationPackage;
}

function translation(x: number, y = 6): SpriteAnimationMatrix {
  return [1, 0, 0, 1, x, y];
}

function rotation(degrees: number): SpriteAnimationMatrix {
  const radians = degrees * Math.PI / 180;
  return [Math.cos(radians), Math.sin(radians), -Math.sin(radians), Math.cos(radians), 4, 6];
}

describe("Lottie animation compiler", () => {
  it("exports embedded image layers, transforms, timing, and markers", () => {
    const result = compileLottieAnimation(createPackage(), { padding: 2 });

    expect(result).toMatchObject({
      fr: 10,
      ip: 0,
      op: 1,
      w: 12,
      h: 10,
      nm: "idle",
      assets: [{
        id: "body",
        w: 8,
        h: 6,
        e: 1,
        p: "data:image/png;base64,cG5n",
      }],
      layers: [{
        ty: 2,
        refId: "body",
        ip: 0,
        op: 1,
        ks: {
          p: { a: 0, k: [6, 5, 0] },
          a: { a: 0, k: [4, 3, 0] },
          s: { a: 0, k: [100, 100, 100] },
          r: { a: 0, k: 0 },
          sk: { a: 0, k: 0 },
          sa: { a: 0, k: 0 },
        },
      }],
      markers: [{ tm: 0, cm: "step", dr: 0 }],
    });
  });

  it("preserves rotation, non-uniform scale, and reflection", () => {
    const result = compileLottieAnimation(createPackage([0, 2, 3, 0, 4, 6]));

    expect(result.layers[0]?.ks).toMatchObject({
      r: { k: 90 },
      s: { k: [200, -300, 100] },
    });
  });

  it("merges consecutive frame elements into one hold-keyframed layer", () => {
    const result = compileLottieAnimation(createAnimatedPackage([
      translation(4),
      translation(5),
      translation(6),
    ]));

    expect(result.layers).toHaveLength(1);
    expect(result.layers[0]).toMatchObject({
      ip: 0,
      op: 3,
      ks: {
        p: {
          a: 1,
          k: [
            { t: 0, s: [6, 5, 0], h: 1 },
            { t: 1, s: [7, 5, 0], h: 1 },
            { t: 2, s: [8, 5, 0], h: 1 },
          ],
        },
      },
    });
  });

  it("compresses exact linear motion only in linear mode", () => {
    const animationPackage = createAnimatedPackage([
      translation(4),
      translation(5),
      translation(6),
    ]);
    const result = compileLottieAnimation(animationPackage, { keyframeMode: "linear" });

    expect(result.layers[0]?.ks.p).toMatchObject({
      a: 1,
      k: [
        { t: 0, s: [6, 5, 0], o: { x: 0, y: 0 }, i: { x: 1, y: 1 } },
        { t: 2, s: [8, 5, 0] },
      ],
    });
  });

  it("retains non-linear motion in linear mode", () => {
    const animationPackage = createAnimatedPackage([
      translation(4),
      translation(5.1),
      translation(6),
    ]);
    const result = compileLottieAnimation(animationPackage, { keyframeMode: "linear" });

    expect(result.layers[0]?.ks.p).toMatchObject({
      a: 1,
      k: [
        { t: 0 },
        { t: 1 },
        { t: 2 },
      ],
    });
  });

  it("accepts numeric visual mode and removes deviations within the pixel tolerance", () => {
    const animationPackage = createAnimatedPackage([
      translation(4),
      translation(5.1),
      translation(6),
    ]);
    const result = compileLottieAnimation(animationPackage, {
      keyframeMode: 2,
      visualTolerance: 0.25,
    });

    expect(result.layers[0]?.ks.p).toMatchObject({
      a: 1,
      k: [
        { t: 0 },
        { t: 2 },
      ],
    });
  });

  it("retains deviations above the visual pixel tolerance", () => {
    const animationPackage = createAnimatedPackage([
      translation(4),
      translation(5.5),
      translation(6),
    ]);
    const result = compileLottieAnimation(animationPackage, {
      keyframeMode: "visual",
      visualTolerance: 0.25,
    });

    expect(result.layers[0]?.ks.p).toMatchObject({
      a: 1,
      k: [
        { t: 0 },
        { t: 1 },
        { t: 2 },
      ],
    });
  });

  it("unwraps rotations before exact linear simplification", () => {
    const animationPackage = createAnimatedPackage([
      rotation(170),
      rotation(180),
      rotation(-170),
    ]);
    const result = compileLottieAnimation(animationPackage, { keyframeMode: 1 });

    expect(result.layers[0]?.ks.r).toMatchObject({
      a: 1,
      k: [
        { t: 0, s: [170], o: { x: 0, y: 0 }, i: { x: 1, y: 1 } },
        { t: 2, s: [190] },
      ],
    });
  });

  it("writes content-addressed external image references", () => {
    const result = compileLottiePackage(createPackage(), {
      embedImages: false,
      imageDirectory: "sprites",
    });
    const asset = result.animation.assets[0];

    expect(asset).toMatchObject({
      id: "body",
      u: "sprites/",
      e: 0,
    });
    expect(asset?.p).toMatch(/^[a-f0-9]{64}\.png$/);
    expect([...result.images.keys()]).toEqual([`sprites/${asset?.p}`]);
    expect(result.images.get(`sprites/${asset?.p}`)?.toString()).toBe("png");
  });

  it("preserves skew through Lottie transform channels", () => {
    const source = createPackage([1, 0, 0.5, 1, 4, 6]);
    const result = compileLottieAnimation(source);
    const skew = -Math.atan(0.5) * 180 / Math.PI;

    expect(result.layers[0]?.ks).toMatchObject({
      r: { a: 0, k: 0 },
      s: { a: 0, k: [100, 100, 100] },
      sk: { a: 0, k: skew },
      sa: { a: 0, k: 0 },
    });
    expect(createSpriteAnimationTransform([
      1,
      0,
      Math.tan(-skew * Math.PI / 180),
      1,
      4,
      6,
    ]).matrix).toEqual(source.document.clips[0]?.frames[0]?.elements[0]?.transform.matrix);
  });

  it("rejects singular matrices that editable transform channels cannot reproduce", () => {
    expect(() => compileLottieAnimation(createPackage([1, 0, 0.5, 0, 4, 6])))
      .toThrow("退化变换矩阵");
  });
});
