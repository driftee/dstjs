import { describe, expect, it } from "vitest";

import { deriveTurfEdgeMapping, lookupTurfEdgeElement, TURF_DIRECTION_LAYOUT, turfEdgeState } from "./mapping.js";
import type { TurfRecognitionReport } from "./recognition.js";

describe("turf edge mapping", () => {
  it("compresses 256 observations into eight local direction tables", () => {
    const report = syntheticRecognitionReport();
    const mapping = deriveTurfEdgeMapping(report);

    expect(mapping.centerElement).toBe(1);
    expect(mapping.validation).toEqual({ masks: 256, comparisons: 2048, conflicts: 0 });
    expect(mapping.directions[0]?.elements).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(lookupTurfEdgeElement(mapping, "N", 0b00000011)).toBe(7);
    expect(turfEdgeState(0b10000001, 0)).toBe(3);
  });
});

function syntheticRecognitionReport(): TurfRecognitionReport {
  return {
    format: "dstjs-turf-recognition:v1",
    geometry: { analysisSize: [864, 495], step: 138, targetMarker: [368, 190] },
    observations: Array.from({ length: 256 }, (_, mask) => ({
      mask,
      file: `mask-${String(mask).padStart(3, "0")}.png`,
      cells: [
        recognitionCell(0, 0, 1),
        ...TURF_DIRECTION_LAYOUT.map((direction) => recognitionCell(
          direction.screenOffset[0],
          direction.screenOffset[1],
          direction.bit * 8 + turfEdgeState(mask, direction.bit) + 1,
        )),
      ],
    })),
    cellSummaries: [],
    inconsistentCells: 0,
    lowConfidenceCells: 0,
  };
}

function recognitionCell(offsetX: number, offsetY: number, element: number) {
  return {
    offset: [offsetX, offsetY] as [number, number],
    element,
    barcodeElement: element,
    digitElement: element,
    confidence: 1,
    consistent: true,
  };
}
