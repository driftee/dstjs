import { describe, expect, it } from "vitest";

import { parseWebAnimationManifest } from "./validate.js";

function manifest() {
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
          elements: [{ sprite: "body", transform: [1, 0, 0, 1, 0, 0], z: 0 }],
        }],
      },
    },
  };
}

describe("web animation manifest validation", () => {
  it("accepts a complete v1 manifest", () => {
    expect(parseWebAnimationManifest(manifest())).toMatchObject({
      format: "dstjs-web-animation",
      version: 1,
    });
  });

  it("rejects missing sprite references", () => {
    const value = manifest();
    value.animations.idle.frames[0]!.elements[0]!.sprite = "missing";

    expect(() => parseWebAnimationManifest(value)).toThrow("不存在的 Sprite missing");
  });

  it("rejects unsupported versions", () => {
    expect(() => parseWebAnimationManifest({ ...manifest(), version: 2 }))
      .toThrow("不支持的 Web Animation manifest 版本");
  });
});
