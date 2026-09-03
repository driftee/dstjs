import { createHash } from "node:crypto";

import { parseAtlasXml, resolveTextureKey } from "../atlas/index.js";
import type { GameAssetSource } from "./source.js";

export async function fingerprintGameAtlas(
  source: Pick<GameAssetSource, "read">,
  atlasKey: string,
  importVersion: string,
  sourceBuildId: string,
): Promise<string> {
  const hash = createHash("sha256");
  hash.update("import-version:");
  hash.update(importVersion);
  hash.update("\0source-build:");
  hash.update(sourceBuildId);
  const xml = await source.read(atlasKey);
  hash.update("\0atlas:");
  hash.update(atlasKey);
  hash.update("\0xml:");
  hash.update(xml);

  const textureKeys = [...new Set(parseAtlasXml(xml.toString("utf8"))
    .map((sheet) => resolveTextureKey(atlasKey, sheet.texture)))]
    .sort();
  for (const textureKey of textureKeys) {
    hash.update("\0texture:");
    hash.update(textureKey);
    hash.update("\0");
    hash.update(await source.read(textureKey));
  }
  return hash.digest("hex");
}
