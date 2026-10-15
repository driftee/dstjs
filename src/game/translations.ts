import { access, readFile, readdir } from "node:fs/promises";
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

export type NameResolution = {
  code: string;
  title: string;
  englishTitle: string;
  key: string;
  source: string | null;
  confidence: "EXACT" | "STATIC" | "AMBIGUOUS" | "UNMATCHED";
  candidates: Array<{
    title: string;
    source: string;
  }>;
};

type TranslationValue = {
  translated: string;
  english: string;
};

export class GameTranslations {
  constructor(
    private readonly values: ReadonlyMap<string, TranslationValue>,
    private readonly source: string | null = null,
  ) {}

  resolve(rawCode: string): AssetTranslation {
    const resolvedName = this.resolveName(rawCode);
    const translationCode = normalizeTranslationCode(resolvedName.code);
    const description = this.values.get(`STRINGS.RECIPE_DESC.${translationCode}`);

    return {
      code: resolvedName.code,
      title: resolvedName.title,
      description: description?.translated ?? "",
      englishTitle: resolvedName.englishTitle,
      confidence: resolvedName.confidence === "EXACT"
        ? (description ? "EXACT" : "NAME_ONLY")
        : "UNMATCHED",
    };
  }

  resolveName(rawCode: string): NameResolution {
    const code = normalizeCode(rawCode);
    const translationCode = normalizeTranslationCode(code);
    const nameKey = `STRINGS.NAMES.${translationCode}`;
    const skinKey = `STRINGS.SKIN_NAMES.${translationCode}`;
    const key = this.values.has(nameKey) ? nameKey : skinKey;
    const name = this.values.get(key);
    return {
      code,
      title: name?.translated || code,
      englishTitle: name?.english ?? "",
      key: name ? key : nameKey,
      source: name ? this.source : null,
      confidence: name ? "EXACT" : "UNMATCHED",
      candidates: name && this.source
        ? [{ title: name.translated, source: this.source }]
        : [],
    };
  }
}

export class ModNameTranslations {
  constructor(
    private readonly candidates: ReadonlyMap<string, ReadonlyArray<{
      title: string;
      source: string;
    }>>,
  ) {}

  resolveName(rawCode: string): NameResolution {
    const code = normalizeCode(rawCode);
    const translationCode = normalizeTranslationCode(code);
    const candidates = uniqueCandidates(this.candidates.get(translationCode) ?? []);
    const chinese = candidates.filter(candidate => containsHan(candidate.title));
    const chineseTitles = [...new Set(chinese.map(candidate => candidate.title))];
    const englishTitles = [...new Set(candidates
      .filter(candidate => !containsHan(candidate.title))
      .map(candidate => candidate.title))];

    if (chineseTitles.length === 1) {
      const title = chineseTitles[0]!;
      const sources = chinese.filter(candidate => candidate.title === title);
      return {
        code,
        title,
        englishTitle: englishTitles.length === 1 ? englishTitles[0]! : "",
        key: `STRINGS.NAMES.${translationCode}`,
        source: sources.length === 1 ? sources[0]!.source : null,
        confidence: "STATIC",
        candidates,
      };
    }

    return {
      code,
      title: code,
      englishTitle: englishTitles.length === 1 ? englishTitles[0]! : "",
      key: `STRINGS.NAMES.${translationCode}`,
      source: null,
      confidence: chineseTitles.length > 1 ? "AMBIGUOUS" : "UNMATCHED",
      candidates,
    };
  }
}

export function parseGameTranslations(
  input: Buffer | string,
  source: string | null = null,
): GameTranslations {
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
  return new GameTranslations(values, source);
}

export async function loadChineseTranslations(dataDirectory: string): Promise<GameTranslations> {
  const loosePath = path.join(dataDirectory, "scripts", "languages", "chinese_s.po");
  if (await exists(loosePath)) {
    return parseGameTranslations(await readFile(loosePath), loosePath);
  }

  const archivePath = path.join(dataDirectory, "databundles", "scripts.zip");
  const content = await readZipEntry(archivePath, "scripts/languages/chinese_s.po");
  return parseGameTranslations(content, `${archivePath}#scripts/languages/chinese_s.po`);
}

export async function loadModNameTranslations(modDirectory: string): Promise<ModNameTranslations> {
  const root = path.resolve(modDirectory);
  const candidates = new Map<string, Array<{ title: string; source: string }>>();
  for (const filename of await listLuaFiles(root)) {
    const relative = path.relative(root, filename).split(path.sep).join("/");
    const parsed = parseModNameAssignments(await readFile(filename, "utf8"), relative);
    for (const [code, values] of parsed) {
      const existing = candidates.get(code) ?? [];
      existing.push(...values);
      candidates.set(code, existing);
    }
  }
  return new ModNameTranslations(candidates);
}

export function parseModNameAssignments(
  source: string,
  sourceName = "<memory>",
): Map<string, Array<{ title: string; source: string }>> {
  const result = new Map<string, Array<{ title: string; source: string }>>();
  const searchable = maskLuaComments(source);
  const assignment = /(?:GLOBAL\.)?STRINGS\.NAMES(?:\.([A-Z][A-Z0-9_]*)|\[\s*["']([A-Z][A-Z0-9_]*)["']\s*\])\s*=\s*([^\r\n]*)/g;
  for (const match of searchable.matchAll(assignment)) {
    const code = match[1] ?? match[2];
    const expression = match[3] ?? "";
    if (!code || !expression) continue;
    const line = searchable.slice(0, match.index).split(/\r?\n/u).length;
    const location = `${sourceName}:${line}`;
    for (const title of luaStringLiterals(expression)) {
      const values = result.get(code) ?? [];
      values.push({ title, source: location });
      result.set(code, values);
    }
  }
  return result;
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

async function listLuaFiles(directory: string): Promise<string[]> {
  const result: string[] = [];
  const visit = async (current: string): Promise<void> => {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if (entry.isFile() && entry.name.toLocaleLowerCase().endsWith(".lua")) result.push(target);
    }
  };
  await visit(directory);
  return result.sort();
}

function luaStringLiterals(expression: string): string[] {
  const result: string[] = [];
  const pattern = /(["'])((?:\\.|(?!\1).)*)\1/g;
  for (const match of expression.matchAll(pattern)) {
    const raw = match[2] ?? "";
    result.push(raw
      .replace(/\\(["'\\])/g, "$1")
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t"));
  }
  return result.filter(value => value.trim().length > 0);
}

function maskLuaComments(source: string): string {
  return source.replace(
    /--\[(=*)\[[\s\S]*?\]\1\]|--[^\r\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g,
    token => token.startsWith("--") ? token.replace(/[^\r\n]/g, " ") : token,
  );
}

function normalizeCode(rawCode: string): string {
  return rawCode.trim().replace(/\.[^.]+$/, "");
}

function normalizeTranslationCode(code: string): string {
  return code.toLocaleUpperCase("en-US").replace(/[^A-Z0-9_]/g, "_");
}

function containsHan(value: string): boolean {
  return /\p{Script=Han}/u.test(value);
}

function uniqueCandidates(
  candidates: ReadonlyArray<{ title: string; source: string }>,
): Array<{ title: string; source: string }> {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.title}\0${candidate.source}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
