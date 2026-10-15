import sharp from "sharp";
import { describe, expect, it } from "vitest";

import type { WebAnimationPackage } from "./types.js";
import {
  compileAnimationEntityScenePackage,
  createAnimationEntityPlayerHtml,
  parseAnimationEntitySceneConfig,
} from "./entity-player.js";

describe("animation entity player", () => {
  it("parses follower sources and rejects ambiguous identities", () => {
    expect(parseAnimationEntitySceneConfig({
      version: 1,
      entities: [{
        id: "pom-left",
        anim: "./pom.zip",
        animation: "idle_loop",
        follow: { layerName: "HAT", buildFrame: 0, x: -75, y: -12 },
        zOffset: 0.01,
      }],
    }).entities[0]).toMatchObject({
      id: "pom-left",
      follow: { layerName: "HAT", buildFrame: 0, x: -75, y: -12 },
    });

    expect(() => parseAnimationEntitySceneConfig({
      version: 1,
      entities: [
        { id: "same", anim: "a.zip", animation: "idle", follow: { layerName: "HAT" } },
        { id: "same", anim: "b.zip", animation: "idle", follow: { layerName: "HAT" } },
      ],
    })).toThrow("实体 ID 重复");
    expect(() => parseAnimationEntitySceneConfig({
      version: 1,
      entities: [{ id: "pom", anim: "a.zip", animation: "idle", follow: {} }],
    })).toThrow("layerName 或 symbolName");
  });

  it("creates a self-contained player with independent follower clocks and anchors", async () => {
    const root = await packageWithPixel("root", 2, {
      layerName: "HAT",
      symbolName: "swap_hat",
      buildFrame: 0,
    });
    const child = await packageWithPixel("child", 3);
    const html = createAnimationEntityPlayerHtml(root, {
      title: "Follower Preview",
      initialAnimation: "idle_loop",
      entities: [{
        id: "pom",
        animation: "swing",
        package: child,
        follow: { layerName: "HAT", buildFrame: 0, x: -75, y: -12 },
        zOffset: 0.01,
        timeOffset: 0.25,
      }],
    });

    expect(html).toContain("Follower Preview");
    expect(html).toContain('id="animation-scene"');
    expect(html).toContain("time + (entity.timeOffset || 0)");
    expect(html).toContain("multiply(anchor.transform");
    expect(html).toContain("right.z - left.z");
    expect(html).toContain('"layerName":"HAT"');
    expect(html).toContain("data.entities.length + \" 个 follower\"");
    expect(html).toContain("data:image/webp;base64,");
  });

  it("packages independent entity timelines into one manifest and atlas", async () => {
    const root = await packageWithPixel("root", 2, {
      layerName: "HAT",
      symbolName: "swap_hat",
      buildFrame: 0,
    });
    const child = await packageWithPixel("child", 3);
    const result = await compileAnimationEntityScenePackage(root, "idle_loop", [{
      id: "pom",
      animation: "swing",
      package: child,
      follow: { layerName: "HAT", buildFrame: 0, x: -75, y: -12 },
      zOffset: 0.01,
    }]);

    expect(result.manifest.scene).toEqual({
      rootAnimation: "idle_loop",
      entities: [{
        id: "pom",
        animation: "entity/pom/swing",
        follow: { layerName: "HAT", buildFrame: 0, x: -75, y: -12 },
        zOffset: 0.01,
      }],
    });
    expect(result.manifest.animations.idle_loop?.frames).toHaveLength(2);
    expect(result.manifest.animations["entity/pom/swing"]?.frames).toHaveLength(3);
    expect(Object.keys(result.manifest.sprites)).toEqual(["root/pixel", "entity/pom/pixel"]);
    await expect(compileAnimationEntityScenePackage(root, "idle_loop", [{
      id: "missing",
      animation: "swing",
      package: child,
      follow: { layerName: "MISSING" },
    }])).rejects.toThrow("找不到主体挂点");

    const metadata = await sharp(result.atlas).metadata();
    expect(metadata).toMatchObject({
      width: result.manifest.atlas.width,
      height: result.manifest.atlas.height,
    });
  });
});

async function packageWithPixel(
  prefix: string,
  frameCount: number,
  semantics: { layerName?: string; symbolName?: string; buildFrame?: number } = {},
): Promise<WebAnimationPackage> {
  const animation = prefix === "root" ? "idle_loop" : "swing";
  return {
    manifest: {
      format: "dstjs-web-animation",
      version: 1,
      atlas: { file: "atlas.webp", width: 1, height: 1 },
      sprites: {
        pixel: { x: 0, y: 0, width: 1, height: 1, originX: 0, originY: 0 },
      },
      animations: {
        [animation]: {
          frameRate: 30,
          duration: frameCount / 30,
          frames: Array.from({ length: frameCount }, (_, index) => ({
            elements: [{
              sprite: "pixel",
              transform: [1, 0, 0, 1, index, index],
              z: 0,
              ...semantics,
            }],
          })),
        },
      },
    },
    atlas: await sharp(Uint8Array.from([255, 255, 255, 255]), {
      raw: { width: 1, height: 1, channels: 4 },
    }).webp({ lossless: true }).toBuffer(),
  };
}
