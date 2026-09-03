import { describe, expect, it } from "vitest";

import { decodeKtex } from "./ktex.js";
import { encodeKtexRgba } from "./encode.js";

describe("encodeKtexRgba", () => {
  it("round-trips top-down RGBA pixels", () => {
    const rgba = Uint8Array.from([
      255, 0, 0, 255, 0, 255, 0, 128,
      0, 0, 255, 255, 255, 255, 255, 0,
    ]);
    const decoded = decodeKtex(encodeKtexRgba({ width: 2, height: 2, rgba }));

    expect(decoded.width).toBe(2);
    expect(decoded.height).toBe(2);
    expect(decoded.compression).toBe("rgba");
    expect(decoded.mipmapCount).toBe(1);
    expect(Array.from(decoded.rgba)).toEqual([
      255, 0, 0, 255, 0, 255, 0, 128,
      0, 0, 255, 255, 0, 0, 0, 0,
    ]);
  });

  it("rejects inconsistent pixel data", () => {
    expect(() => encodeKtexRgba({ width: 2, height: 2, rgba: new Uint8Array(4) }))
      .toThrow("RGBA 数据长度应为 16");
  });
});
