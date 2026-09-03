import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

import { decodeKtex } from "../texture/ktex.js";
import { parseAtlasXml, resolveTextureKey, safeImageName, uvToRectangle } from "./xml.js";

export type ExtractedImage = {
  code: string;
  sourceName: string;
  filename: string;
  width: number;
  height: number;
  texture: string;
};

export type AtlasManifest = {
  atlas: string;
  textures: number;
  images: ExtractedImage[];
};

export type ExtractedAtlasImage = ExtractedImage & {
  bytes: Buffer;
};

export async function* extractAtlasImages(input: {
  atlasKey: string;
  readResource: (key: string) => Promise<Buffer>;
}): AsyncGenerator<ExtractedAtlasImage> {
  const xml = (await input.readResource(input.atlasKey)).toString("utf8");
  const sheets = parseAtlasXml(xml);
  const usedFilenames = new Set<string>();

  for (const sheet of sheets) {
    const textureKey = resolveTextureKey(input.atlasKey, sheet.texture);
    const decoded = decodeKtex(await input.readResource(textureKey));
    const raw = {
      width: decoded.width,
      height: decoded.height,
      channels: 4 as const,
    };
    const texture = sharp(Buffer.from(decoded.rgba), { raw });
    for (const element of sheet.elements) {
      const filename = safeImageName(element.name);
      if (usedFilenames.has(filename)) {
        throw new Error(`Atlas ${input.atlasKey} 包含重复输出名：${filename}`);
      }
      usedFilenames.add(filename);
      const rectangle = uvToRectangle(element, decoded.width, decoded.height);
      const bytes = await texture.clone()
        .extract(rectangle)
        .png({ compressionLevel: 9 })
        .toBuffer();
      yield {
        code: filename.slice(0, -4),
        sourceName: element.name,
        filename,
        width: rectangle.width,
        height: rectangle.height,
        texture: textureKey,
        bytes,
      };
    }
  }
}

export async function extractAtlas(input: {
  atlasKey: string;
  outputDirectory: string;
  readResource: (key: string) => Promise<Buffer>;
}): Promise<AtlasManifest> {
  const xml = (await input.readResource(input.atlasKey)).toString("utf8");
  const sheets = parseAtlasXml(xml);
  const atlasDirectory = path.join(input.outputDirectory, atlasFolderName(input.atlasKey));
  await mkdir(atlasDirectory, { recursive: true });

  const images: ExtractedImage[] = [];
  for await (const image of extractAtlasImages(input)) {
    await writeFile(path.join(atlasDirectory, image.filename), image.bytes);
    images.push({
      code: image.code,
      sourceName: image.sourceName,
      filename: image.filename,
      width: image.width,
      height: image.height,
      texture: image.texture,
    });
  }

  const manifest = {
    atlas: input.atlasKey,
    textures: sheets.length,
    images,
  } satisfies AtlasManifest;
  await writeFile(path.join(atlasDirectory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}

export async function extractAtlasFiles(
  xmlPath: string,
  texturePath: string | null,
  outputDirectory: string,
): Promise<AtlasManifest> {
  const atlasKey = path.basename(xmlPath);
  return extractAtlas({
    atlasKey,
    outputDirectory,
    readResource: async (key) => {
      if (key === atlasKey) return readFile(xmlPath);
      if (texturePath) return readFile(texturePath);
      return readFile(path.join(path.dirname(xmlPath), path.basename(key)));
    },
  });
}

export function atlasFolderName(atlasKey: string): string {
  const withoutExtension = atlasKey.replace(/^images\//, "").replace(/\.xml$/i, "");
  const safe = withoutExtension.replaceAll("/", "__").replace(/[^A-Za-z0-9._-]+/g, "_");
  if (!safe) throw new Error(`Atlas 路径无效：${atlasKey}`);
  return safe;
}
