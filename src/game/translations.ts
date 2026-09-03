import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { buffer } from "node:stream/consumers";
import type { Readable } from "node:stream";

import { po } from "gettext-parser";
import yauzl, { type Entry, type ZipFile } from "yauzl";

export type AssetTranslation = {
  code: string;
  title: string;
  description: string;
  englishTitle: string;
  confidence: "EXACT" | "NAME_ONLY" | "UNMATCHED";
};

type TranslationValue = {
  translated: string;
  english: string;
};

export class GameTranslations {
  constructor(private readonly values: ReadonlyMap<string, TranslationValue>) {}

  resolve(rawCode: string): AssetTranslation {
    const code = rawCode.replace(/\.[^.]+$/, "");
    const translationCode = code.toLocaleUpperCase("en-US").replace(/[^A-Z0-9_]/g, "_");
    const name = this.values.get(`STRINGS.NAMES.${translationCode}`)
      ?? this.values.get(`STRINGS.SKIN_NAMES.${translationCode}`);
    const description = this.values.get(`STRINGS.RECIPE_DESC.${translationCode}`);

    return {
      code,
      title: name?.translated || code,
      description: description?.translated ?? "",
      englishTitle: name?.english ?? "",
      confidence: name
        ? (description ? "EXACT" : "NAME_ONLY")
        : "UNMATCHED",
    };
  }
}

export function parseGameTranslations(input: Buffer | string): GameTranslations {
  const catalog = po.parse(input);
  const values = new Map<string, TranslationValue>();
  for (const [context, messages] of Object.entries(catalog.translations)) {
    if (!context) continue;
    const message = Object.values(messages)[0];
    if (!message) continue;
    const translated = message.msgstr.find((value) => value.trim().length > 0)?.trim() ?? "";
    if (!translated) continue;
    values.set(context, { translated, english: message.msgid.trim() });
  }
  return new GameTranslations(values);
}

export async function loadChineseTranslations(dataDirectory: string): Promise<GameTranslations> {
  const loosePath = path.join(dataDirectory, "scripts", "languages", "chinese_s.po");
  if (await exists(loosePath)) return parseGameTranslations(await readFile(loosePath));

  const archivePath = path.join(dataDirectory, "databundles", "scripts.zip");
  const content = await readZipEntry(archivePath, "scripts/languages/chinese_s.po");
  return parseGameTranslations(content);
}

function exists(target: string): Promise<boolean> {
  return access(target).then(() => true, () => false);
}

function readZipEntry(filename: string, target: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    yauzl.open(filename, { lazyEntries: true, validateEntrySizes: true }, (openError, zip) => {
      if (openError || !zip) {
        reject(openError ?? new Error(`无法打开 ZIP：${filename}`));
        return;
      }
      let settled = false;
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        zip.close();
        reject(error);
      };
      zip.on("entry", (entry: Entry) => {
        if (entry.fileName !== target) {
          zip.readEntry();
          return;
        }
        if (entry.uncompressedSize > 32 * 1024 * 1024) {
          fail(new Error(`翻译文件超过 32 MiB 限制：${target}`));
          return;
        }
        openEntryStream(zip, entry)
          .then(buffer)
          .then((content) => {
            if (settled) return;
            settled = true;
            zip.close();
            resolve(content);
          }, fail);
      });
      zip.once("end", () => fail(new Error(`ZIP 中找不到翻译文件：${target}`)));
      zip.once("error", fail);
      zip.readEntry();
    });
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
