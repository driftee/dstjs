import { describe, expect, it } from "vitest";
import { Texture } from "three";

import type { WebAnimationManifest } from "@driftee/dstjs-core/web-animation";

import { createDstThreeAnimationSource } from "./source.js";

function manifest(): WebAnimationManifest {
  return {
    format: "dstjs-web-animation",
    version: 1,
    atlas: { file: "atlas.webp", width: 32, height: 16 },
    sprites: {
      body: { x: 2, y: 3, width: 10, height: 8, originX: 5, originY: 4 },
    },
    animations: {
      idle: {
        frameRate: 10,
        duration: 0.2,
        frames: [
          { elements: [{ sprite: "body", transform: [1, 0, 0, 1, 0, 0], z: 0 }] },
          { elements: [{ sprite: "body", transform: [1, 0, 0, 1, 4, 2], z: 1 }] },
        ],
      },
    },
  };
}

describe("DST.js Three.js adapter", () => {
  it("shares sprite geometry and material across animation instances", () => {
    const source = createDstThreeAnimationSource(manifest(), new Texture());
    const first = source.createInstance({ animation: "idle" });
    const second = source.createInstance({ animation: "idle" });

    const firstMesh = first.object.children[0];
    const secondMesh = second.object.children[0];
    expect(firstMesh?.type).toBe("Mesh");
    expect(secondMesh?.type).toBe("Mesh");
    expect((firstMesh as { geometry?: unknown }).geometry)
      .toBe((secondMesh as { geometry?: unknown }).geometry);
    expect((firstMesh as { material?: unknown }).material)
      .toBe((secondMesh as { material?: unknown }).material);

    source.dispose();
  });

  it("updates frame transforms with a host-driven clock", () => {
    const source = createDstThreeAnimationSource(manifest(), new Texture());
    const animation = source.createInstance({ animation: "idle", playing: true });

    animation.update(0.1);

    expect(animation.frame).toBe(1);
    const mesh = animation.object.children[0]!;
    expect(mesh.matrix.elements[12]).toBe(4);
    expect(mesh.matrix.elements[13]).toBe(-2);
    expect(mesh.matrix.elements[14]).toBe(1);
    source.dispose();
  });
});
