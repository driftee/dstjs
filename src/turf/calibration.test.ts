import { describe, expect, it } from "vitest";

import { parseAtlasXml } from "../atlas/xml.js";
import { decodeKtex } from "../texture/ktex.js";
import { createTurfCalibrationAssets, NINE_SAMPLE_BIT_ORDER } from "./calibration.js";

describe("turf calibration assets", () => {
  it("defines the agreed eight-neighbour bit order", () => {
    expect(NINE_SAMPLE_BIT_ORDER).toEqual(["N", "NE", "E", "SE", "S", "SW", "W", "NW"]);
  });

  it("creates 48 numbered atlas elements and valid KTEX files", async () => {
    const assets = await createTurfCalibrationAssets();
    const [atlas] = parseAtlasXml(assets.atlasXml);
    const decodedAtlas = decodeKtex(assets.atlasKtex);
    const decodedNoise = decodeKtex(assets.noiseKtex);

    expect(atlas?.elements).toHaveLength(48);
    expect(atlas?.elements.map((element) => element.name).sort()).toContain("01");
    expect(atlas?.elements.map((element) => element.name).sort()).toContain("48");
    expect(decodedAtlas).toMatchObject({ width: 512, height: 512, compression: "rgba" });
    expect(decodedNoise).toMatchObject({ width: 64, height: 64, compression: "rgba" });
  });
});
