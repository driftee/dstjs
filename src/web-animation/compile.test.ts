import sharp from "sharp";
import { describe, expect, it } from "vitest";

import type { AnimationBundle } from "../animation/archive.js";
import { parseAnimation } from "../animation/parse-animation.js";
import { parseBuild } from "../animation/parse-build.js";
import { createAnimationBinary, createBuildBinary } from "../animation/test-helpers.js";
import { compileWebAnimation } from "./compile.js";
import { createAnimationPlayerHtml } from "./player.js";
import { createPetalSceneHtml } from "./scene.js";

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

describe("Web animation compiler", () => {
  it("compiles DST triangles and transforms into a WebP atlas manifest", async () => {
    const result = await compileWebAnimation(createBundle());
    const metadata = await sharp(result.atlas).metadata();
    const { data } = await sharp(result.atlas).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const clip = result.manifest.animations.idle;

    expect(result.manifest).toMatchObject({
      format: "dstjs-web-animation",
      version: 1,
      atlas: { file: "atlas.webp" },
    });
    expect(metadata.format).toBe("webp");
    expect([...data].filter((_, index) => index % 4 === 3).some((alpha) => alpha > 0)).toBe(true);
    expect(Object.keys(result.manifest.sprites)).toHaveLength(1);
    expect(clip).toMatchObject({ frameRate: 10, duration: 0.1 });
    expect(clip?.frames[0]?.elements[0]).toMatchObject({
      transform: [1, 0, 0, 1, 0, 0],
      z: 0,
    });
  });

  it("resolves symbol overrides before rasterizing sprites", async () => {
    const bundle = createBundle();
    const source = bundle.build.symbols[0];
    if (!source) throw new Error("missing synthetic symbol");
    bundle.build.symbols.push({ ...source, hash: 5, name: "pink_square" });

    const result = await compileWebAnimation(bundle, {
      symbolOverrides: { square: "pink_square" },
    });

    expect(Object.keys(result.manifest.sprites)).toEqual(["5:0"]);
    expect(result.manifest.animations.idle?.frames[0]?.elements[0]?.sprite).toBe("5:0");
  });

  it("creates a standalone two-layer scene with interactive controls", async () => {
    const result = await compileWebAnimation(createBundle());
    const html = createPetalSceneHtml(result, {
      title: "Test Petals",
      initialDensity: 12,
      variants: { red: result, pink: result },
      initialVariant: "pink",
    });

    expect(html).toContain("<!doctype html>");
    expect(html).toContain("Test Petals");
    expect(html).toContain('id="effect-background"');
    expect(html).toContain('id="effect-foreground"');
    expect(html).toContain('id="density"');
    expect(html).toContain('id="variant"');
    expect(html).toContain('<option value="pink" selected>pink</option>');
    expect(html).toContain('value="12"');
    expect(html).toContain('data-animation-clip checked');
    expect(html).toContain('id="clip-count">1/1');
    expect(html).toContain("updateClipSelection");
    expect(html).toContain("data:image/webp;base64,");
    expect(html).toContain('format":"dstjs-web-animation"');
    expect(html).toContain("loadVariant");
  });

  it("creates a self-contained single entity player", async () => {
    const result = await compileWebAnimation(createBundle());
    const element = result.manifest.animations.idle?.frames[0]?.elements[0];
    if (!element) throw new Error("missing synthetic element");
    element.transform = [1, 2, 3, 1, 0, 0];
    const html = createAnimationPlayerHtml(result, {
      title: "Mr. Skitts",
      initialAnimation: "idle",
    });

    expect(html).toContain("<!doctype html>");
    expect(html).toContain("Mr. Skitts");
    expect(html).toContain('id="player"');
    expect(html).toContain('id="animation"');
    expect(html).toContain('<option value="idle" selected>idle</option>');
    expect(html).toContain('id="replay"');
    expect(html).toContain('id="loop"');
    expect(html).toContain("defaultLoop");
    expect(html).toContain("clip.duration - 1 / clip.frameRate");
    expect(html).toContain("context.transform(a, b, c, d, tx, ty)");
    expect(html).toContain('"bounds":{"idle":{"left":-8,"top":-6,"right":8,"bottom":6}}');
    expect(html).toContain("data:image/webp;base64,");
  });

});
