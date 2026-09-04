import { describe, expect, it } from "vitest";

import type {
  SpriteAnimationClip,
  SpriteAnimationElement,
} from "./types.js";
import { createSpriteAnimationTransform } from "./transform.js";
import { trackSpriteAnimationClip } from "./track.js";

function element(x: number, z: number): SpriteAnimationElement {
  return {
    spriteId: "body",
    layerId: "body",
    layerName: "Body",
    transform: createSpriteAnimationTransform([1, 0, 0, 1, x, 0]),
    z,
  };
}

describe("sprite animation tracking", () => {
  it("keeps duplicate layer instances on the nearest deterministic track", () => {
    const clip: SpriteAnimationClip = {
      id: "test",
      name: "test",
      frameRate: 10,
      durationFrames: 3,
      frames: [
        { bounds: { x: 0, y: 0, width: 20, height: 10 }, events: [], elements: [element(-5, 2), element(5, 1)] },
        { bounds: { x: 0, y: 0, width: 20, height: 10 }, events: [], elements: [element(-4, 2), element(4, 1)] },
        { bounds: { x: 0, y: 0, width: 20, height: 10 }, events: [], elements: [element(-3, 2), element(3, 1)] },
      ],
    };

    const tracks = trackSpriteAnimationClip(clip);

    expect(tracks).toHaveLength(2);
    expect(tracks[0]?.samples.map((sample) => sample?.transform.matrix[4])).toEqual([-5, -4, -3]);
    expect(tracks[1]?.samples.map((sample) => sample?.transform.matrix[4])).toEqual([5, 4, 3]);
  });

  it("starts and ends tracks when elements appear or disappear", () => {
    const clip: SpriteAnimationClip = {
      id: "test",
      name: "test",
      frameRate: 10,
      durationFrames: 3,
      frames: [
        { bounds: { x: 0, y: 0, width: 10, height: 10 }, events: [], elements: [] },
        { bounds: { x: 0, y: 0, width: 10, height: 10 }, events: [], elements: [element(1, 0)] },
        { bounds: { x: 0, y: 0, width: 10, height: 10 }, events: [], elements: [] },
      ],
    };

    const tracks = trackSpriteAnimationClip(clip);

    expect(tracks).toHaveLength(1);
    expect(tracks[0]?.samples.map((sample) => sample?.frame ?? null)).toEqual([null, 1, null]);
  });
});
