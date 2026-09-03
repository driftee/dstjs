import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { GameAssetSource } from "./source.js";
import { zipWithEmptyFiles } from "./test-helpers.js";

describe("GameAssetSource", () => {
  it("indexes loose and bundled big portrait atlases", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "dstjs-source-"));
    await mkdir(path.join(root, "images"));
    await mkdir(path.join(root, "bigportraits"));
    await mkdir(path.join(root, "databundles"));
    await writeFile(path.join(root, "bigportraits", "wilson_none.xml"), "");
    await writeFile(
      path.join(root, "databundles", "bigportraits.zip"),
      zipWithEmptyFiles([
        "bigportraits/wickerbottom_none.xml",
        "bigportraits/willow_none.xml",
      ]),
    );

    const source = await GameAssetSource.open(root);
    try {
      expect(source.listAtlasKeys()).toEqual([
        "bigportraits/wickerbottom_none.xml",
        "bigportraits/willow_none.xml",
        "bigportraits/wilson_none.xml",
      ]);
      await expect(source.read("bigportraits/wickerbottom_none.xml")).resolves.toEqual(Buffer.alloc(0));
    } finally {
      source.close();
    }
  });

  it("rejects unsafe ZIP entry names through the open promise", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "dstjs-source-"));
    await mkdir(path.join(root, "images"));
    await mkdir(path.join(root, "databundles"));
    await writeFile(
      path.join(root, "databundles", "images.zip"),
      zipWithEmptyFiles(["../evil.xml"]),
    );

    await expect(GameAssetSource.open(root)).rejects.toThrow(/不安全的资源路径|invalid relative path/);
  });
});
