import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

import { parseAtlasXml, resolveTextureKey, uvToRectangle } from "../atlas/xml.js";
import { decodeKtex } from "../texture/ktex.js";
import type { CatalogTurf, TurfCatalog } from "./catalog.js";

export type ModTurf = CatalogTurf & {
  source: string;
  insertion: { target: string; after: boolean };
};

export type ModTurfCatalog = {
  format: "dstjs-mod-turf:v1";
  mod: {
    id: string;
    name: string;
    version: string | null;
    workshopId: string;
  };
  turfs: ModTurf[];
  excluded: { key: string; reason: string }[];
};

type ModTileDefinition = {
  key: string;
  groundName: string;
  atlas: string;
  texture: string;
  noise: string;
  inventory: string | null;
  inventoryIcon: string | null;
  flooring: boolean;
  insertion: { target: string; after: boolean } | null;
};

export async function writeModTurfCatalog(options: {
  modDirectory: string;
  baseCatalogPath: string;
  outputDirectory: string;
  id: string;
  workshopId: string;
}): Promise<ModTurfCatalog> {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(options.id)) throw new Error("模组资源包 ID 格式无效");
  if (!/^\d{6,20}$/.test(options.workshopId)) throw new Error("Workshop ID 格式无效");

  const modDirectory = path.resolve(options.modDirectory);
  const outputDirectory = path.resolve(options.outputDirectory);
  const packageRoot = path.join(outputDirectory, "mods", options.id);
  const source = await findTileSource(modDirectory);
  const lua = await readFile(source, "utf8");
  const definitions = parseModTileDefinitions(lua);
  const baseCatalog = JSON.parse(await readFile(path.resolve(options.baseCatalogPath), "utf8")) as TurfCatalog;
  const translations = await loadModTranslations(modDirectory);
  const modInfo = await readModInfo(modDirectory);

  await mkdir(path.join(packageRoot, "assets"), { recursive: true });
  await mkdir(path.join(packageRoot, "icons"), { recursive: true });
  const iconCodes = new Set(definitions.flatMap(definition => (
    definition.inventoryIcon ? [definition.inventoryIcon] : []
  )));
  const icons = await exportModIcons(modDirectory, iconCodes, packageRoot);
  const textureCache = new Map<string, { filename: string; width: number; height: number; color: string }>();

  const exportTexture = async (relativePath: string) => {
    const normalized = safeRelative(relativePath);
    const cached = textureCache.get(normalized);
    if (cached) return cached;
    const decoded = decodeKtex(await readFile(path.join(modDirectory, normalized)), { unpremultiplyAlpha: false });
    const image = sharp(Buffer.from(decoded.rgba), {
      raw: { width: decoded.width, height: decoded.height, channels: 4 },
    });
    const filename = `mods/${options.id}/assets/${normalized.replace(/\.tex$/i, "").replaceAll("/", "__")}.png`;
    const { channels } = await image.stats();
    const color = `#${channels.slice(0, 3).map(channel => (
      Math.round(channel.mean).toString(16).padStart(2, "0")
    )).join("")}`;
    await image.png({ compressionLevel: 9 }).toFile(path.join(outputDirectory, filename));
    const result = { filename, width: decoded.width, height: decoded.height, color };
    textureCache.set(normalized, result);
    return result;
  };

  const turfs: ModTurf[] = [];
  const excluded: ModTurfCatalog["excluded"] = [];
  for (const definition of definitions) {
    if (!definition.inventory) {
      excluded.push({ key: definition.key, reason: "无 inventory 地皮物品（特殊/临时地面）" });
      continue;
    }
    if (!definition.insertion) {
      excluded.push({ key: definition.key, reason: "缺少 ChangeTileRenderOrder，无法确定原版覆盖优先级" });
      continue;
    }

    const customAtlasXml = path.join(modDirectory, "levels", "tiles", `${definition.atlas}.xml`);
    const customAtlasTex = path.join(modDirectory, "levels", "tiles", `${definition.texture}.tex`);
    let atlas: string;
    let elements: CatalogTurf["elements"];
    if (await exists(customAtlasXml) && await exists(customAtlasTex)) {
      const sheets = parseAtlasXml(await readFile(customAtlasXml, "utf8"));
      if (sheets.length !== 1) throw new Error(`不支持多纹理地皮 atlas：${customAtlasXml}`);
      const exported = await exportTexture(`levels/tiles/${definition.texture}.tex`);
      atlas = exported.filename;
      elements = Object.fromEntries(sheets[0]!.elements.map(element => [
        String(Number(element.name)),
        uvToRectangle(element, exported.width, exported.height),
      ]));
    } else {
      const base = baseCatalog.turfs.find(turf => (
        path.basename(turf.atlas, ".png").endsWith(`__${definition.atlas}`)
      ));
      if (!base) throw new Error(`${definition.key} 引用了不存在的原版地皮 atlas：${definition.atlas}`);
      atlas = base.atlas;
      elements = base.elements;
    }

    const noise = await exportTexture(`levels/textures/${definition.noise}.tex`);
    const label = translations.get(definition.inventory.toUpperCase()) ?? definition.groundName;
    turfs.push({
      key: `${options.id}:${definition.key}`,
      label,
      inventory: definition.inventory,
      icon: icons.get(definition.inventoryIcon!)!,
      renderOrder: 0,
      flooring: definition.flooring,
      atlas,
      noise: noise.filename,
      color: noise.color,
      elements,
      source: options.id,
      insertion: definition.insertion,
    });
  }

  const catalog: ModTurfCatalog = {
    format: "dstjs-mod-turf:v1",
    mod: {
      id: options.id,
      name: modInfo.name ?? options.id,
      version: modInfo.version,
      workshopId: options.workshopId,
    },
    turfs,
    excluded,
  };
  await writeFile(path.join(packageRoot, "catalog.json"), `${JSON.stringify(catalog, null, 2)}\n`);
  await writeFile(path.join(packageRoot, "manifest.json"), `${JSON.stringify({
    format: "dstjs-mod-manifest:v1",
    ...catalog.mod,
    sourceSha256: createHash("sha256").update(lua).digest("hex"),
    turfCount: turfs.length,
  }, null, 2)}\n`);
  return catalog;
}

export function parseModTileDefinitions(source: string): ModTileDefinition[] {
  const clean = stripLuaComments(source);
  const order = new Map<string, { target: string; after: boolean }>();
  for (const match of clean.matchAll(
    /ChangeTileRenderOrder\(WORLD_TILES\.([A-Z][A-Z0-9_]*),WORLD_TILES\.([A-Z][A-Z0-9_]*)(?:,(true|false))?\)/g,
  )) {
    order.set(match[1]!, { target: match[2]!.toLowerCase(), after: match[3] === "true" });
  }

  const result: ModTileDefinition[] = [];
  for (const call of luaCalls(clean, "AddTile")) {
    const args = splitLuaValues(call);
    const key = literalString(args[0]);
    if (!key || !/^[A-Z][A-Z0-9_]*$/.test(key)) throw new Error("AddTile 使用了非字面量地皮键");
    if (literalString(args[1]) !== "LAND") continue;
    const metadata = fields(args[2]);
    const ground = fields(args[3]);
    const turf = fields(args[5]);
    const texture = literalString(ground.name);
    const noise = literalString(ground.noise_texture);
    if (!texture || !noise) throw new Error(`${key} 使用了动态地皮资源，暂不支持`);
    const inventoryName = literalString(turf.name);
    result.push({
      key: key.toLowerCase(),
      groundName: literalString(metadata.ground_name) ?? key,
      atlas: literalString(ground.atlas) ?? texture,
      texture,
      noise,
      inventory: inventoryName ? `turf_${inventoryName}` : null,
      inventoryIcon: inventoryName
        ? `turf_${literalString(turf.invicon_override) ?? inventoryName}`
        : null,
      flooring: ground.flooring === "true",
      insertion: order.get(key) ?? null,
    });
  }
  if (!result.length) throw new Error("没有找到可解析的 AddTile LAND 声明");
  return result;
}

async function exportModIcons(
  modDirectory: string,
  wanted: ReadonlySet<string>,
  packageRoot: string,
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const imagesRoot = path.join(modDirectory, "images");
  for (const filename of await readdir(imagesRoot)) {
    if (!filename.endsWith(".xml")) continue;
    const atlasPath = path.join(imagesRoot, filename);
    for (const sheet of parseAtlasXml(await readFile(atlasPath, "utf8"))) {
      const matching = sheet.elements.filter(element => wanted.has(element.name.replace(/\.tex$/, "")));
      if (!matching.length) continue;
      const texturePath = path.join(imagesRoot, path.basename(resolveTextureKey(filename, sheet.texture)));
      const decoded = decodeKtex(await readFile(texturePath));
      const image = sharp(Buffer.from(decoded.rgba), {
        raw: { width: decoded.width, height: decoded.height, channels: 4 },
      });
      for (const element of matching) {
        const code = element.name.replace(/\.tex$/, "");
        const filename = `icons/${code}.png`;
        await image.clone().extract(uvToRectangle(element, decoded.width, decoded.height))
          .resize(64, 64, { fit: "contain" })
          .png({ compressionLevel: 9 }).toFile(path.join(packageRoot, filename));
        result.set(code, `mods/${path.basename(packageRoot)}/${filename}`);
      }
    }
  }
  const missing = [...wanted].filter(code => !result.has(code));
  if (missing.length) throw new Error(`模组缺少 inventory 图标：${missing.join(", ")}`);
  return result;
}

async function loadModTranslations(modDirectory: string): Promise<Map<string, string>> {
  const candidates = [
    "scripts/cherry_strings/ch/strings.lua",
    "scripts/strings/zh/strings.lua",
    "scripts/strings/ch/strings.lua",
  ];
  const result = new Map<string, string>();
  for (const candidate of candidates) {
    const filename = path.join(modDirectory, candidate);
    if (!await exists(filename)) continue;
    const source = await readFile(filename, "utf8");
    for (const match of source.matchAll(/NAMES\.([A-Z][A-Z0-9_]*)\s*=\s*"((?:\\.|[^"\\])*)"/g)) {
      result.set(match[1]!, match[2]!.replace(/\\"/g, '"'));
    }
  }
  return result;
}

async function findTileSource(modDirectory: string): Promise<string> {
  const preferred = [
    "init/init_tiles.lua",
    "scripts/init_tiles.lua",
    "modmain.lua",
  ];
  for (const candidate of preferred) {
    const filename = path.join(modDirectory, candidate);
    if (await exists(filename) && (await readFile(filename, "utf8")).includes("AddTile(")) return filename;
  }
  throw new Error("未找到包含 AddTile 的受支持地皮注册文件");
}

async function readModInfo(modDirectory: string): Promise<{ name: string | null; version: string | null }> {
  const source = await readFile(path.join(modDirectory, "modinfo.lua"), "utf8");
  const value = (field: string) => source.match(new RegExp(`^${field}\\s*=\\s*"([^"]*)"`, "m"))?.[1] ?? null;
  return { name: value("name")?.replace(/[\u{F0000}-\u{FFFFD}]/gu, "").trim() ?? null, version: value("version") };
}

function luaCalls(source: string, name: string): string[] {
  const result: string[] = [];
  const pattern = new RegExp(`\\b${name}\\(`, "g");
  for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
    const start = match.index + match[0].length;
    const end = closingParenthesis(source, start);
    result.push(source.slice(start, end));
    pattern.lastIndex = end + 1;
  }
  return result;
}

function stripLuaComments(source: string): string {
  return (source.match(/--\[(=*)\[[\s\S]*?\]\1\]|--[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s]/g) ?? [])
    .filter(token => !token.startsWith("--"))
    .join("");
}

function literalString(value?: string): string | null {
  if (!value || !/^("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')$/.test(value)) return null;
  return value.slice(1, -1).replace(/\\([\\"'])/g, "$1");
}

function fields(value?: string): Record<string, string> {
  if (!value || value === "nil") return {};
  if (!value.startsWith("{") || !value.endsWith("}")) throw new Error("地皮定义应为字面量 Lua table");
  return Object.fromEntries(splitLuaValues(value.slice(1, -1)).filter(Boolean).map(entry => {
    const match = entry.match(/^([a-zA-Z_][a-zA-Z0-9_]*)=([\s\S]+)$/);
    if (!match) throw new Error(`暂不支持的地皮字段：${entry}`);
    return [match[1]!, match[2]!];
  }));
}

function closingParenthesis(source: string, start: number): number {
  let depth = 1;
  let quote = "";
  for (let index = start; index < source.length; index++) {
    const char = source[index]!;
    if (quote) {
      if (char === "\\") index++;
      else if (char === quote) quote = "";
    } else if (char === '"' || char === "'") quote = char;
    else if (char === "(") depth++;
    else if (char === ")" && --depth === 0) return index;
  }
  throw new Error("Lua 调用缺少右括号");
}

function splitLuaValues(source: string): string[] {
  const values: string[] = [];
  let start = 0;
  let depth = 0;
  let quote = "";
  for (let index = 0; index < source.length; index++) {
    const char = source[index]!;
    if (quote) {
      if (char === "\\") index++;
      else if (char === quote) quote = "";
    } else if (char === '"' || char === "'") quote = char;
    else if ("({[".includes(char)) depth++;
    else if (")}]".includes(char)) depth--;
    else if (char === "," && depth === 0) {
      values.push(source.slice(start, index));
      start = index + 1;
    }
  }
  if (quote || depth !== 0) throw new Error("Lua table 括号不平衡");
  values.push(source.slice(start));
  return values;
}

function safeRelative(filename: string): string {
  const normalized = path.posix.normalize(filename.replaceAll("\\", "/"));
  if (normalized.startsWith("../") || path.posix.isAbsolute(normalized)) throw new Error(`不安全的资源路径：${filename}`);
  return normalized;
}

async function exists(filename: string): Promise<boolean> {
  return readFile(filename).then(() => true, () => false);
}
