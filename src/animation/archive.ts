import { buffer } from "node:stream/consumers";
import type { Readable } from "node:stream";
import path from "node:path";

import yauzl, { type Entry, type ZipFile } from "yauzl";

import { decodeKtex, type DecodedKtex } from "../texture/ktex.js";
import { parseAnimation } from "./parse-animation.js";
import { parseBuild } from "./parse-build.js";
import type { AnimationFile, BuildFile } from "./types.js";

const MAX_ENTRY_BYTES = 128 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;

export type AnimationBundle = {
  animation: AnimationFile;
  build: BuildFile;
  atlases: ReadonlyMap<string, DecodedKtex>;
};

export async function openAnimationBundle(filename: string): Promise<AnimationBundle> {
  const resources = await readArchive(filename);
  const animationBytes = requireUniqueBasename(resources, "anim.bin");
  const buildBytes = requireUniqueBasename(resources, "build.bin");
  const animation = parseAnimation(animationBytes);
  const build = parseBuild(buildBytes);
  const atlases = new Map<string, DecodedKtex>();
  for (const atlasName of build.atlases) {
    const atlasBytes = requireUniqueBasename(resources, path.posix.basename(atlasName));
    atlases.set(atlasName, decodeKtex(atlasBytes));
  }
  return { animation, build, atlases };
}

async function readArchive(filename: string): Promise<Map<string, Buffer>> {
  const zip = await openZip(filename);
  const resources = new Map<string, Buffer>();
  let totalBytes = 0;
  try {
    const entries = await listEntries(zip);
    for (const entry of entries) {
      if (entry.uncompressedSize > MAX_ENTRY_BYTES) {
        throw new Error(`动画资源超过 ${MAX_ENTRY_BYTES / 1024 / 1024} MiB 限制：${entry.fileName}`);
      }
      totalBytes += entry.uncompressedSize;
      if (totalBytes > MAX_ARCHIVE_BYTES) {
        throw new Error(`动画压缩包解压后超过 ${MAX_ARCHIVE_BYTES / 1024 / 1024} MiB 限制`);
      }
      resources.set(normalizeEntryName(entry.fileName), await buffer(await openEntryStream(zip, entry)));
    }
  } finally {
    zip.close();
  }
  return resources;
}

function requireUniqueBasename(resources: ReadonlyMap<string, Buffer>, basename: string): Buffer {
  const matches = [...resources].filter(([key]) => path.posix.basename(key) === basename);
  if (matches.length === 0) throw new Error(`动画压缩包中找不到 ${basename}`);
  if (matches.length > 1) throw new Error(`动画压缩包中存在多个 ${basename}`);
  const value = matches[0]?.[1];
  if (!value) throw new Error(`动画压缩包中的 ${basename} 无法读取`);
  return value;
}

function normalizeEntryName(value: string): string {
  const normalized = value.replaceAll("\\", "/").replace(/^\/+/, "");
  if (!normalized || normalized.split("/").includes("..")) {
    throw new Error(`动画压缩包包含不安全路径：${value}`);
  }
  return normalized;
}

function openZip(filename: string): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(filename, { autoClose: false, lazyEntries: true, validateEntrySizes: true }, (error, zip) => {
      if (error) reject(error);
      else if (!zip) reject(new Error(`无法打开动画 ZIP：${filename}`));
      else resolve(zip);
    });
  });
}

function listEntries(zip: ZipFile): Promise<Entry[]> {
  return new Promise((resolve, reject) => {
    const entries: Entry[] = [];
    zip.on("entry", (entry: Entry) => {
      if (!entry.fileName.endsWith("/")) entries.push(entry);
      zip.readEntry();
    });
    zip.once("end", () => resolve(entries));
    zip.once("error", reject);
    zip.readEntry();
  });
}

function openEntryStream(zip: ZipFile, entry: Entry): Promise<Readable> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error) reject(error);
      else if (!stream) reject(new Error(`无法读取动画 ZIP 资源：${entry.fileName}`));
      else resolve(stream);
    });
  });
}
