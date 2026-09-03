import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";

import { createKtex } from "../texture/test-helpers.js";
import { extractAtlas } from "./extract.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

describe("extractAtlas", () => {
  it("writes one cropped PNG and a manifest", async () => {
    const outputDirectory = await mkdtemp(path.join(tmpdir(), "dstjs-"));
    temporaryDirectories.push(outputDirectory);
    const xml = Buffer.from(
      '<Atlas><Texture filename="test.tex"/><Elements>'
      + '<Element name="red.tex" u1="0" u2="0.5" v1="0.5" v2="1"/>'
      + "</Elements></Atlas>",
    );
    const texture = createKtex({
      compression: 4,
      width: 2,
      height: 2,
      pitch: 8,
      pixels: Buffer.from([
        0, 0, 255, 255, 255, 255, 255, 255,
        255, 0, 0, 255, 0, 255, 0, 255,
      ]),
    });
    const resources = new Map([
      ["images/test.xml", xml],
      ["images/test.tex", texture],
    ]);

    const manifest = await extractAtlas({
      atlasKey: "images/test.xml",
      outputDirectory,
      readResource: async (key) => {
        const value = resources.get(key);
        if (!value) throw new Error(`missing ${key}`);
        return value;
      },
    });

    expect(manifest.images).toEqual([{
      code: "red",
      sourceName: "red.tex",
      filename: "red.png",
      width: 1,
      height: 1,
      texture: "images/test.tex",
    }]);
    const image = await sharp(path.join(outputDirectory, "test", "red.png")).raw().toBuffer();
    expect([...image]).toEqual([255, 0, 0, 255]);
    await expect(readFile(path.join(outputDirectory, "test", "manifest.json"), "utf8"))
      .resolves.toContain('"code": "red"');
  });
});
