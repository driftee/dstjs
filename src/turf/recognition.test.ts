import { describe, expect, it } from "vitest";

import { decodeSevenSegmentMask } from "./recognition.js";

describe("turf recognition", () => {
  it("decodes the fixed seven-segment alphabet", () => {
    expect(decodeSevenSegmentMask(0b0111111)).toBe(0);
    expect(decodeSevenSegmentMask(0b0000110)).toBe(1);
    expect(decodeSevenSegmentMask(0b1011011)).toBe(2);
    expect(decodeSevenSegmentMask(0b1101111)).toBe(9);
    expect(decodeSevenSegmentMask(0)).toBeNull();
  });
});
