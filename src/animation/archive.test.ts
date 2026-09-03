import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { zipWithEmptyFiles, zipWithFiles } from "../game/test-helpers.js";
import { createKtex } from "../texture/test-helpers.js";
import { inspectAnimationArchive, openAnimationBundle } from "./archive.js";
import { createAnimationBinary, createBuildBinary } from "./test-helpers.js";

describe("animation archives", () => {
  it("inspects animation, build, and atlas entries without decoding them", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "dstjs-animation-"));
    const filename = path.join(root, "bundle.zip");
    await writeFile(filename, zipWithEmptyFiles([
      "anim/ANIM.BIN",
      "build/build.bin",
      "build/atlas-0.tex",
      "build/atlas-1.TEX",
    ]));

    await expect(inspectAnimationArchive(filename)).resolves.toEqual({
      hasAnimation: true,
      hasBuild: true,
      atlasCount: 2,
    });
  });

  it("rejects archives with excessive entry counts", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "dstjs-animation-"));
    const filename = path.join(root, "oversized.zip");
    await writeFile(
      filename,
      zipWithEmptyFiles(Array.from({ length: 20_001 }, (_, index) => `${index}.bin`)),
    );

    await expect(inspectAnimationArchive(filename)).rejects.toThrow(/条目数超过 20000 限制/);
  });

  it("combines separate animation and build archives for ktools compatibility", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "dstjs-animation-"));
    const animationFilename = path.join(root, "animation.zip");
    const buildFilename = path.join(root, "build.zip");
    await writeFile(animationFilename, zipWithFiles([
      { filename: "anim.bin", bytes: createAnimationBinary() },
    ]));
    await writeFile(buildFilename, zipWithFiles([
      { filename: "build.bin", bytes: createBuildBinary() },
      {
        filename: "atlas-0.tex",
        bytes: createKtex({
          compression: 4,
          width: 2,
          height: 2,
          pitch: 8,
          pixels: Buffer.alloc(16, 255),
        }),
      },
    ]));

    await expect(openAnimationBundle([
      animationFilename,
      buildFilename,
    ])).resolves.toMatchObject({
      build: { name: "test_build" },
      animation: { animations: [{ name: "idle" }] },
    });
  });
});
