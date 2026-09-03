import { describe, expect, it } from "vitest";

import { parseTurfCaptureLine, parseWindowBounds, TurfCaptureLogDecoder } from "./capture.js";

describe("turf capture protocol", () => {
  it("parses capture-ready and complete events", () => {
    expect(parseTurfCaptureLine("[DSTJS_TURF_CAPTURE] event=capture_ready mask=037")).toEqual([
      { type: "ready", mask: 37 },
    ]);
    expect(parseTurfCaptureLine("[DSTJS_TURF_CALIBRATION] event=complete masks=256")).toEqual([
      { type: "complete" },
    ]);
    expect(parseTurfCaptureLine("[DSTJS_TURF_CAPTURE] event=capture_ready mask=999")).toEqual([]);
  });

  it("keeps split log lines between chunks", () => {
    const decoder = new TurfCaptureLogDecoder();
    expect(decoder.push("prefix [DSTJS_TURF_CAPTURE] event=capture_")).toEqual([]);
    expect(decoder.push("ready mask=005\nnoise\n")).toEqual([{ type: "ready", mask: 5 }]);
  });

  it("parses macOS window bounds", () => {
    expect(parseWindowBounds("0, 25, 1728, 989\n")).toEqual({ x: 0, y: 25, width: 1728, height: 989 });
    expect(() => parseWindowBounds("no window")).toThrow("无法解析 DST 窗口范围");
  });
});
