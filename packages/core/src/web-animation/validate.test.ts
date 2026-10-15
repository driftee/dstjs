import { describe, expect, it } from "vitest";

import type { WebAnimationManifest } from "./types.js";
import { parseWebAnimationManifest } from "./validate.js";

function manifest(): WebAnimationManifest {
  return {
    format: "dstjs-web-animation",
    version: 1,
    atlas: { file: "atlas.webp", width: 64, height: 64 },
    sprites: {
      body: { x: 0, y: 0, width: 16, height: 16, originX: 8, originY: 8 },
    },
    animations: {
      idle: {
        frameRate: 10,
        duration: 0.1,
        frames: [{
          elements: [{ sprite: "body", transform: [1, 0, 0, 1, 0, 0] as const, z: 0 }],
        }],
      },
    },
  };
}

describe("web animation manifest validation", () => {
  it("accepts a complete v1 manifest", () => {
    const value = manifest();
    Object.assign(value.animations.idle!.frames[0]!.elements[0]!, {
      layerName: "HAT",
      symbolName: "swap_hat",
      buildFrame: 0,
    });
    expect(parseWebAnimationManifest(value)).toMatchObject({
      format: "dstjs-web-animation",
      version: 1,
    });
  });

  it("validates optional DST element semantics", () => {
    const value = manifest();
    Object.assign(value.animations.idle!.frames[0]!.elements[0]!, { buildFrame: -1 });
    expect(() => parseWebAnimationManifest(value)).toThrow("buildFrame");
  });


  it("accepts independent scene entity timelines and rejects missing clips", () => {
    const value = manifest();
    value.animations.swing = {
      frameRate: 30,
      duration: 0.1,
      frames: [{ elements: [{ sprite: "body", transform: [1, 0, 0, 1, 0, 0] as const, z: 0 }] }],
    };
    Object.assign(value, {
      scene: {
        rootAnimation: "idle",
        entities: [{
          id: "pom",
          animation: "swing",
          follow: { layerName: "HAT", x: -75, y: -12 },
          zOffset: 0.01,
        }],
      },
    });
    expect(parseWebAnimationManifest(value).scene?.entities[0]?.animation).toBe("swing");
    value.scene!.entities[0]!.animation = "missing";
    expect(() => parseWebAnimationManifest(value)).toThrow("不存在的动画 missing");
  });
  it("rejects missing sprite references", () => {
    const value = manifest();
    value.animations.idle!.frames[0]!.elements[0]!.sprite = "missing";

    expect(() => parseWebAnimationManifest(value)).toThrow("不存在的 Sprite missing");
  });

  it("rejects unsupported versions", () => {
    expect(() => parseWebAnimationManifest({ ...manifest(), version: 2 }))
      .toThrow("不支持的 Web Animation manifest 版本");
  });
});
