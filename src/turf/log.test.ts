import { describe, expect, it } from "vitest";

import { parseTurfCalibrationLog } from "./log.js";

describe("parseTurfCalibrationLog", () => {
  it("collects mask markers and exposes an atlas-element result slot", () => {
    const result = parseTurfCalibrationLog([
      "unrelated output",
      "[DSTJS_TURF_CALIBRATION] event=mask mask=000 bits=00000000 center=12,34 order=N,NE,E,SE,S,SW,W,NW",
      "[DSTJS_TURF_CALIBRATION] event=mask mask=037 bits=10100100 center=-2,7 order=N,NE,E,SE,S,SW,W,NW",
      "[DSTJS_TURF_CALIBRATION] event=complete masks=256",
    ].join("\n"));

    expect(result.observations).toEqual([
      { mask: 0, bits: "00000000", center: [12, 34], atlasElement: null },
      { mask: 37, bits: "10100100", center: [-2, 7], atlasElement: null },
    ]);
    expect(result.missingMasks).not.toContain(0);
    expect(result.missingMasks).not.toContain(37);
    expect(result.missingMasks).toHaveLength(254);
    expect(result.rendererReportedComplete).toBe(true);
  });

  it("reports repeated masks", () => {
    const marker = "[DSTJS_TURF_CALIBRATION] event=mask mask=001 bits=10000000 center=0,0";
    expect(parseTurfCalibrationLog(`${marker}\n${marker}`).duplicateMasks).toEqual([1]);
  });
});
