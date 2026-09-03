import { describe, expect, it } from "vitest";

import { isMirroredEightFacingBit } from "./facing.js";

describe("isMirroredEightFacingBit", () => {
  it("mirrors the three left-side facings that share animation records", () => {
    expect(Array.from({ length: 8 }, (_, facing) =>
      isMirroredEightFacingBit(1 << facing))).toEqual([
      false,
      false,
      true,
      false,
      false,
      true,
      false,
      true,
    ]);
  });
});
