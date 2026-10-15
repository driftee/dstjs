import { describe, expect, it } from "vitest";
import { buildManifest } from "./build-manifest.js";
import { parseBuild } from "./parse-build.js";
import { createBuildBinary } from "./test-helpers.js";
import { formatCliHelp } from "../cli-help.js";

describe("build manifest", () => {
  it("is discoverable in CLI help", () => {
    expect(formatCliHelp(["anim"])).toContain("inspect-build");
    expect(formatCliHelp(["anim", "inspect-build"])).toContain("不需要 anim.bin");
  });
  it("reports the complete build without requiring ANIM and preserves offsets", () => {
    const build = parseBuild(createBuildBinary());
    const frame = build.symbols[0]!.frames[0]!;
    frame.bounds = { x: 12, y: -9, width: 80, height: 60 };
    build.symbols[0]!.frames.push({ ...frame, frameNumber: 17, duration: 3 });
    const result = buildManifest(build);
    expect(result.frameCount).toBe(2);
    expect(result.symbolCount).toBe(1);
    expect(result.symbols[0]!.frames[1]).toMatchObject({
      frameNumber: 17, duration: 3, originX: 28, originY: 39,
    });
  });
});
