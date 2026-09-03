import { describe, expect, it } from "vitest";

import { fingerprintGameAtlas } from "./atlas-fingerprint.js";

const atlasXml = Buffer.from(
  '<Atlas><Texture filename="inventory.tex"/><Elements><Element name="item.tex" u1="0" u2="1" v1="0" v2="1"/></Elements></Atlas>',
);

function source(texture = "texture") {
  return {
    read: async (key: string) => key.endsWith(".xml") ? atlasXml : Buffer.from(texture),
  };
}

describe("fingerprintGameAtlas", () => {
  it("is stable for identical atlas inputs", async () => {
    const first = await fingerprintGameAtlas(source(), "images/inventory.xml", "2", "build-1");
    const second = await fingerprintGameAtlas(source(), "images/inventory.xml", "2", "build-1");

    expect(first).toBe(second);
  });

  it("changes with the source build or texture bytes", async () => {
    const original = await fingerprintGameAtlas(source(), "images/inventory.xml", "2", "build-1");
    const newBuild = await fingerprintGameAtlas(source(), "images/inventory.xml", "2", "build-2");
    const newTexture = await fingerprintGameAtlas(source("new-texture"), "images/inventory.xml", "2", "build-1");

    expect(newBuild).not.toBe(original);
    expect(newTexture).not.toBe(original);
  });
});
