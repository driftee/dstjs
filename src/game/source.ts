import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { buffer } from "node:stream/consumers";
import type { Readable } from "node:stream";

import yauzl, { type Entry, type ZipFile } from "yauzl";

const MAX_ARCHIVE_ENTRY_BYTES = 64 * 1024 * 1024;

export class GameAssetSource {
  private constructor(
    readonly dataDirectory: string,
    private readonly looseFiles: ReadonlyMap<string, string>,
    private readonly archive: ZipFile | null,
    private readonly archiveEntries: ReadonlyMap<string, Entry>,
  ) {}

  static async open(gamePath: string): Promise<GameAssetSource> {
    const dataDirectory = await resolveDataDirectory(gamePath);
    const looseFiles = await indexLooseFiles(dataDirectory);
    const archivePath = path.join(dataDirectory, "databundles", "images.zip");
    const hasArchive = await exists(archivePath);
    if (!hasArchive) return new GameAssetSource(dataDirectory, looseFiles, null, new Map());

    const archive = await openZip(archivePath);
    const archiveEntries = await indexZip(archive);
    return new GameAssetSource(dataDirectory, looseFiles, archive, archiveEntries);
  }

  listAtlasKeys(): string[] {
    return [...new Set([
      ...[...this.archiveEntries.keys()].filter((key) => key.endsWith(".xml")),
      ...[...this.looseFiles.keys()].filter((key) => key.endsWith(".xml")),
    ])].sort();
  }

  async read(key: string): Promise<Buffer> {
    const normalized = normalizeKey(key);
    const loosePath = this.looseFiles.get(normalized);
    if (loosePath) return readFile(loosePath);

    const entry = this.archiveEntries.get(normalized);
    if (!entry || !this.archive) throw new Error(`找不到游戏资源：${normalized}`);
    if (entry.uncompressedSize > MAX_ARCHIVE_ENTRY_BYTES) {
      throw new Error(`压缩包资源超过 ${MAX_ARCHIVE_ENTRY_BYTES / 1024 / 1024} MiB 限制：${normalized}`);
    }
    return buffer(await openEntryStream(this.archive, entry));
  }

  close(): void {
    this.archive?.close();
  }
}

export async function resolveDataDirectory(input: string): Promise<string> {
  const candidates = [
    input,
    path.join(input, "data"),
    path.join(input, "dontstarve_steam.app", "Contents", "data"),
    path.join(input, "Contents", "data"),
  ];
  for (const candidate of candidates) {
    if (await exists(path.join(candidate, "images"))) return candidate;
  }
  throw new Error(`无法在 ${input} 中找到饥荒 data/images 目录`);
}

async function indexLooseFiles(root: string): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const imagesDirectory = path.join(root, "images");
  await walk(imagesDirectory, async (absolutePath) => {
    const key = normalizeKey(path.relative(root, absolutePath));
    result.set(key, absolutePath);
  });
  return result;
}

async function walk(directory: string, visit: (absolutePath: string) => Promise<void>): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(absolutePath, visit);
    else if (entry.isFile()) await visit(absolutePath);
  }
}

function normalizeKey(value: string): string {
  const normalized = value.replaceAll("\\", "/").replace(/^\/+/, "");
  if (normalized.split("/").includes("..")) throw new Error(`不安全的资源路径：${value}`);
  return normalized;
}

function exists(target: string): Promise<boolean> {
  return access(target).then(() => true, () => false);
}

function openZip(filename: string): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(filename, { autoClose: false, lazyEntries: true, validateEntrySizes: true }, (error, zip) => {
      if (error) reject(error);
      else if (!zip) reject(new Error(`无法打开 ZIP：${filename}`));
      else resolve(zip);
    });
  });
}

function indexZip(zip: ZipFile): Promise<Map<string, Entry>> {
  return new Promise((resolve, reject) => {
    const entries = new Map<string, Entry>();
    zip.on("entry", (entry: Entry) => {
      const key = normalizeKey(entry.fileName);
      if (!key.endsWith("/")) entries.set(key, entry);
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
      else if (!stream) reject(new Error(`无法读取 ZIP 资源：${entry.fileName}`));
      else resolve(stream);
    });
  });
}
