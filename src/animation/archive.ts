import type { Readable } from "node:stream";
import path from "node:path";

import yauzl, { type Entry, type ZipFile } from "yauzl";

import { decodeKtex, type DecodedKtex } from "../texture/ktex.js";
import { parseAnimation } from "./parse-animation.js";
import { parseBuild } from "./parse-build.js";
import type { AnimationFile, BuildFile } from "./types.js";

const MAX_ENTRY_BYTES = 128 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 20_000;

export type AnimationBundle = {
  animation: AnimationFile;
  build: BuildFile;
  atlases: ReadonlyMap<string, DecodedKtex>;
};

export type BuildBundle = {
  build: BuildFile;
  atlases: ReadonlyMap<string, DecodedKtex>;
};

export type OpenAnimationBundleOptions = {
  buildFilename?: string;
};

export type AnimationArchiveSummary = {
  hasAnimation: boolean;
  hasBuild: boolean;
  atlasCount: number;
};

export async function inspectAnimationArchive(filename: string): Promise<AnimationArchiveSummary> {
  const zip = await openZip(filename);
  try {
    const entries = (await listEntries(zip)).map((entry) => normalizeEntryName(entry.fileName));
    return {
      hasAnimation: entries.some((entry) => path.posix.basename(entry).toLowerCase() === "anim.bin"),
      hasBuild: entries.some((entry) => path.posix.basename(entry).toLowerCase() === "build.bin"),
      atlasCount: entries.filter((entry) => entry.toLowerCase().endsWith(".tex")).length,
    };
  } finally {
    zip.close();
  }
}

export async function openAnimationFile(filename: string): Promise<AnimationFile> {
  const resources = await readArchive(filename);
  return parseAnimation(requireUniqueBasename(resources, "anim.bin"));
}

export function openAnimationBundle(
  filename: string,
  options?: OpenAnimationBundleOptions,
): Promise<AnimationBundle>;
export function openAnimationBundle(filenames: readonly string[]): Promise<AnimationBundle>;
export async function openAnimationBundle(
  input: string | readonly string[],
  options: OpenAnimationBundleOptions = {},
): Promise<AnimationBundle> {
  if (typeof input !== "string") return openCombinedAnimationBundle(input);
  const filename = input;
  const animationResources = await readArchive(filename);
  const animationBytes = requireUniqueBasename(animationResources, "anim.bin");
  const animation = parseAnimation(animationBytes);
  const { build, atlases } = await openBuildResources(
    options.buildFilename ? await readArchive(options.buildFilename) : animationResources,
  );
  return { animation, build, atlases };
}

export async function openBuildBundle(filename: string): Promise<BuildBundle> {
  return openBuildResources(await readArchive(filename));
}

async function openBuildResources(buildResources: ReadonlyMap<string, Buffer>): Promise<BuildBundle> {
  const buildBytes = requireUniqueBasename(buildResources, "build.bin");
  const build = parseBuild(buildBytes);
  const atlases = new Map<string, DecodedKtex>();
  for (const atlasName of build.atlases) {
    const atlasBytes = requireUniqueBasename(buildResources, path.posix.basename(atlasName));
    atlases.set(atlasName, decodeKtex(atlasBytes));
  }
  return { build, atlases };
}

async function openCombinedAnimationBundle(filenames: readonly string[]): Promise<AnimationBundle> {
  if (filenames.length < 1 || filenames.length > 4) {
    throw new Error("动画解析需要 1 到 4 个资源 ZIP");
  }
  const resources = new Map<string, Buffer[]>();
  let totalBytes = 0;
  for (const filename of filenames) {
    for (const [entryName, bytes] of await readArchive(filename, MAX_ARCHIVE_BYTES - totalBytes)) {
      totalBytes += bytes.byteLength;
      const basename = path.posix.basename(entryName).toLowerCase();
      resources.set(basename, [...(resources.get(basename) ?? []), bytes]);
    }
  }
  const animation = requireSingleParsedResource(resources, "anim.bin", parseAnimation);
  const build = requireSingleParsedResource(resources, "build.bin", parseBuild);
  const atlases = new Map<string, DecodedKtex>();
  for (const atlasName of build.atlases) {
    atlases.set(atlasName, decodeKtex(requireSingleResource(
      resources,
      path.posix.basename(atlasName).toLowerCase(),
    )));
  }
  return { animation, build, atlases };
}

async function readArchive(
  filename: string,
  maximumBytes = MAX_ARCHIVE_BYTES,
): Promise<Map<string, Buffer>> {
  const zip = await openZip(filename);
  try {
    return await readArchiveEntries(zip, maximumBytes);
  } finally {
    zip.close();
  }
}

function readArchiveEntries(zip: ZipFile, maximumBytes: number): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) => {
    const resources = new Map<string, Buffer>();
    let entryCount = 0;
    let totalBytes = 0;
    let settled = false;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    zip.on("entry", (entry: Entry) => {
      if (settled) return;
      entryCount += 1;
      if (entryCount > MAX_ARCHIVE_ENTRIES) {
        fail(new Error(`动画压缩包条目数超过 ${MAX_ARCHIVE_ENTRIES} 限制`));
        return;
      }
      if (entry.fileName.endsWith("/")) {
        zip.readEntry();
        return;
      }
      void (async () => {
        const entryName = normalizeEntryName(entry.fileName);
        if (entry.uncompressedSize > MAX_ENTRY_BYTES) {
          throw new Error(`动画资源超过 ${MAX_ENTRY_BYTES / 1024 / 1024} MiB 限制：${entry.fileName}`);
        }
        totalBytes += entry.uncompressedSize;
        if (totalBytes > maximumBytes) {
          throw new Error(`动画压缩包解压后超过 ${MAX_ARCHIVE_BYTES / 1024 / 1024} MiB 限制`);
        }
        resources.set(entryName, await readStream(await openEntryStream(zip, entry)));
        if (!settled) zip.readEntry();
      })().catch(fail);
    });
    zip.once("end", () => {
      if (settled) return;
      settled = true;
      resolve(resources);
    });
    zip.once("error", fail);
    zip.readEntry();
  });
}

function requireSingleResource(resources: ReadonlyMap<string, Buffer[]>, basename: string): Buffer {
  const matches = resources.get(basename.toLowerCase()) ?? [];
  if (matches.length === 0) throw new Error(`动画资源中找不到 ${basename}`);
  const distinct = matches.filter((value, index) =>
    matches.findIndex((candidate) => candidate.equals(value)) === index);
  if (distinct.length > 1) throw new Error(`动画资源中存在多个 ${basename}，请只提供必要的 ZIP`);
  const value = distinct[0];
  if (!value) throw new Error(`动画资源 ${basename} 无法读取`);
  return value;
}

function requireSingleParsedResource<T>(
  resources: ReadonlyMap<string, Buffer[]>,
  basename: string,
  parse: (input: Uint8Array) => T,
): T {
  const matches = resources.get(basename.toLowerCase()) ?? [];
  if (matches.length === 0) throw new Error(`动画资源中找不到 ${basename}`);
  const distinct = matches.filter((value, index) =>
    matches.findIndex((candidate) => candidate.equals(value)) === index);
  const parsed: T[] = [];
  const errors: string[] = [];
  for (const bytes of distinct) {
    try {
      parsed.push(parse(bytes));
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (parsed.length === 0) throw new Error(`${basename} 均无法解析：${errors.join("；")}`);
  if (parsed.length > 1) {
    throw new Error(`动画资源中存在多个有效的 ${basename}，请只提供必要的 ZIP`);
  }
  const value = parsed[0];
  if (!value) throw new Error(`动画资源 ${basename} 无法读取`);
  return value;
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
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    zip.on("entry", (entry: Entry) => {
      if (settled) return;
      if (entries.length >= MAX_ARCHIVE_ENTRIES) {
        fail(new Error(`动画压缩包条目数超过 ${MAX_ARCHIVE_ENTRIES} 限制`));
        zip.close();
        return;
      }
      if (!entry.fileName.endsWith("/")) entries.push(entry);
      zip.readEntry();
    });
    zip.once("end", () => {
      if (settled) return;
      settled = true;
      resolve(entries);
    });
    zip.once("error", fail);
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

function readStream(stream: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    stream.once("end", () => resolve(Buffer.concat(chunks)));
    stream.once("error", reject);
  });
}
