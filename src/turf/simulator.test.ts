import { describe, expect, it } from "vitest";

import type { TurfNativeLookupReport } from "./recognition.js";
import {
  CALIBRATION_SCREEN_VECTORS,
  createTurfSimulatorHtml,
  GROUND_DETAIL_OPACITY,
} from "./simulator.js";

describe("turf simulator", () => {
  it("starts in the angled game view and embeds all data locally", () => {
    const html = createTurfSimulatorHtml({ mapping: mappingFixture(), turfs: [] });
    expect(html).toContain("rotateX(57deg)");
    expect(html).toContain("rotateZ(var(--rotation))");
    expect(html).toContain("游戏斜视角");
    expect(html).toContain("context.scale(1, -1)");
    expect(html).toContain('id="simulator-data"');
    expect(html).not.toContain("fetch(");
    expect(html).toContain(`context.globalAlpha = ${GROUND_DETAIL_OPACITY}`);
    expect(html).toContain('key === "q" ? -45 : 45');
    expect(html).toContain('rotation += key === "q" ? -45 : 45');
    expect(html).not.toContain('rotation = (rotation + (key === "q" ? -45 : 45) + 360) % 360');
  });

  it("rotates world directions into the heading-zero calibration screen", () => {
    expect(CALIBRATION_SCREEN_VECTORS).toEqual([
      [1, 0],
      [1, 1],
      [0, 1],
      [-1, 1],
      [-1, 0],
      [-1, -1],
      [0, -1],
      [1, -1],
    ]);
    const html = createTurfSimulatorHtml({ mapping: mappingFixture(), turfs: [] });
    expect(html).toContain(`const vectors = ${JSON.stringify(CALIBRATION_SCREEN_VECTORS)}`);
  });
});

function mappingFixture(): TurfNativeLookupReport {
  return {
    format: "dstjs-turf-native-lookup:v1",
    bitOrder: ["N", "NE", "E", "SE", "S", "SW", "W", "NW"],
    geometry: { analysisSize: [864, 495], step: 138, targetMarker: [368, 190] },
    elements: Array.from({ length: 256 }, (_, mask) => mask === 0 ? 0 : 1),
    observations: [],
    inconsistentMasks: [],
    lowConfidenceMasks: [],
  };
}
