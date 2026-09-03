import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";

import yauzl, { type Entry, type ZipFile } from "yauzl";

const MAX_ARCHIVE_ENTRY_BYTES = 64 * 1024 * 1024;

type ArchiveEntry = {
  archive: ZipFile;
  entry: Entry;
};

export class GameAssetSource {
  private constructor(
    readonly dataDirectory: string,
    private readonly looseFiles: ReadonlyMap<string, string>,
    private readonly archives: readonly ZipFile[],
    private readonly archiveEntries: ReadonlyMap<string, ArchiveEntry>,
  ) {}

  static async open(gamePath: string): Promise<GameAssetSource> {
    const dataDirectory = await resolveDataDirectory(gamePath);
    const looseFiles = await indexLooseFiles(dataDirectory);
    const archives: ZipFile[] = [];
    const archiveEntries = new Map<string, ArchiveEntry>();
    try {
      for (const archiveName of ["images.zip", "bigportraits.zip"]) {
        const archivePath = path.join(dataDirectory, "databundles", archiveName);
        if (!await exists(archivePath)) continue;
        const archive = await openZip(archivePath);
        archives.push(archive);
        for (const [key, entry] of await indexZip(archive)) {
          archiveEntries.set(key, { archive, entry });
        }
      }
    } catch (error) {
      for (const archive of archives) archive.close();
      throw error;
    }
    return new GameAssetSource(dataDirectory, looseFiles, archives, archiveEntries);
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

    const archived = this.archiveEntries.get(normalized);
    if (!archived) throw new Error(`找不到游戏资源：${normalized}`);
    if (archived.entry.uncompressedSize > MAX_ARCHIVE_ENTRY_BYTES) {
      throw new Error(`压缩包资源超过 ${MAX_ARCHIVE_ENTRY_BYTES / 1024 / 1024} MiB 限制：${normalized}`);
    }
    return readStream(await openEntryStream(archived.archive, archived.entry));
  }

  close(): void {
    for (const archive of this.archives) archive.close();
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
  for (const directoryName of ["images", "bigportraits"]) {
    const directory = path.join(root, directoryName);
    if (!await exists(directory)) continue;
    await walk(directory, async (absolutePath) => {
      const key = normalizeKey(path.relative(root, absolutePath));
      result.set(key, absolutePath);
    });
  }
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
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    zip.on("entry", (entry: Entry) => {
      if (settled) return;
      try {
        const key = normalizeKey(entry.fileName);
        if (!key.endsWith("/")) entries.set(key, entry);
        zip.readEntry();
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
      }
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
      else if (!stream) reject(new Error(`无法读取 ZIP 资源：${entry.fileName}`));
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
