import { describe, expect, it } from "vitest";

import {
  composeSpriteAnimationTransform,
  createSpriteAnimationTransform,
  decomposeSpriteAnimationTransform,
  spriteAnimationTransformChannelsAreExact,
  withSpriteAnimationTransformChannels,
} from "./transform.js";
import type {
  SpriteAnimationMatrix,
  SpriteAnimationTransformChannels,
} from "./types.js";

describe("sprite animation transforms", () => {
  it.each([
    {
      position: [4, 6],
      rotation: 0,
      scale: [1, 1],
      skewX: 0,
    },
    {
      position: [-12, 8],
      rotation: 37,
      scale: [2, 0.5],
      skewX: 24,
    },
    {
      position: [0, 0],
      rotation: -90,
      scale: [2, -3],
      skewX: -15,
    },
  ] satisfies SpriteAnimationTransformChannels[])(
    "round-trips editable channels through the affine matrix",
    (channels) => {
      const matrix = composeSpriteAnimationTransform(channels);
      const decomposed = decomposeSpriteAnimationTransform(matrix);

      expectMatrix(composeSpriteAnimationTransform(decomposed), matrix);
    },
  );

  it.each([
    { matrix: [0, 0, -2, 0, 4, 6] },
    { matrix: [0, 0, 0, 0, 4, 6] },
  ] satisfies Array<{ matrix: SpriteAnimationMatrix }>)("handles zero horizontal scale", ({ matrix }) => {
    const transform = createSpriteAnimationTransform(matrix);

    expectMatrix(composeSpriteAnimationTransform(transform.channels), matrix);
    expect(spriteAnimationTransformChannelsAreExact(transform)).toBe(true);
  });

  it("keeps the source matrix until editable channels are changed", () => {
    const transform = createSpriteAnimationTransform([1, 0, 0.5, 0, 4, 6]);

    expect(transform.matrix).toEqual([1, 0, 0.5, 0, 4, 6]);
    expect(spriteAnimationTransformChannelsAreExact(transform)).toBe(false);

    const updated = withSpriteAnimationTransformChannels(transform, {
      position: [10, 20],
    });
    expect(updated.channels.position).toEqual([10, 20]);
    expect(updated.matrix).toEqual(composeSpriteAnimationTransform(updated.channels));
    expect(spriteAnimationTransformChannelsAreExact(updated)).toBe(true);
  });
});

function expectMatrix(actual: SpriteAnimationMatrix, expected: SpriteAnimationMatrix): void {
  for (const [index, value] of actual.entries()) {
    expect(value).toBeCloseTo(expected[index] ?? Number.NaN, 9);
  }
}
