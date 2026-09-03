import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

import { parseAtlasXml, resolveTextureKey, uvToRectangle } from "../atlas/xml.js";
import { readGameScript } from "../game/scripts.js";
import { GameAssetSource } from "../game/source.js";
import { loadChineseTranslations } from "../game/translations.js";
import { decodeKtex } from "../texture/ktex.js";
import { parseVanillaTileDefinitions, type VanillaTileDefinition } from "./definitions.js";
import type { TurfNativeLookupReport } from "./recognition.js";
import { writeTurfGrading } from "./grading.js";
import { writeTurfOceanAssets } from "./ocean.js";

export type CatalogTurf = {
  key: string;
  label: string;
  inventory: string | null;
  icon: string | null;
  renderOrder: number;
  flooring: boolean;
  atlas: string;
  noise: string;
  color: string;
  elements: Record<string, { left: number; top: number; width: number; height: number }>;
};

export type TurfCatalog = {
  format: "dstjs-turf-catalog:v1";
  source: { tiledefsSha256: string; totalDefinitions: number; inventoryTurfs: number };
  base: string;
  mapping: number[];
  turfs: CatalogTurf[];
  structures?: CatalogTurf[];
  eraser: { inventory: string; label: string; icon: string; replacement: string };
  excluded: { key: string; range: string; reason: string }[];
};

/** Export the inventory-backed vanilla turf set, plus the native dig-to DIRT base. */
export async function writeTurfCatalog(options: {
  dataDirectory: string;
  outputDirectory: string;
  mapping: TurfNativeLookupReport;
}): Promise<TurfCatalog> {
  if (options.mapping.format !== "dstjs-turf-native-lookup:v1" || options.mapping.elements.length !== 256
    || options.mapping.elements.some((value) => !Number.isInteger(value) || value < 0 || value > 48)) {
    throw new Error("Expected a complete 256-entry calibrated native lookup");
  }
  const source = await GameAssetSource.open(options.dataDirectory);
  try {
    const lua = await readGameScript(source.dataDirectory, "tiledefs.lua");
    const definitions = parseVanillaTileDefinitions(lua);
    const included = definitions.filter((tile) => tile.range === "LAND" && (tile.inventory || tile.key === "dirt" || tile.key === "monkey_dock"));
    const translations = await loadChineseTranslations(source.dataDirectory);
    const output = path.resolve(options.outputDirectory);
    await mkdir(path.join(output, "assets"), { recursive: true });
    await mkdir(path.join(output, "icons"), { recursive: true });
    const iconCodes = new Set(["pitchfork", "dock_kit", ...included.flatMap((tile) => tile.inventoryIcon ? [tile.inventoryIcon] : [])]);
    const icons = await exportInventoryIcons(source, iconCodes, output);

    const textures = new Map<string, { filename: string; width: number; height: number; color: string }>();
    const readResource = (key: string) => key.startsWith("images/")
      ? source.read(key) : readFile(path.join(source.dataDirectory, key));
    const texture = async (key: string) => {
      const cached = textures.get(key);
      if (cached) return cached;
      // ground.ksh samples stored RGB, then applies noise and alpha once.
      // Sprite-style unpremultiplication brightens/clips the translucent fringe.
      const decoded = decodeKtex(await readResource(key), { unpremultiplyAlpha: false });
      const image = sharp(Buffer.from(decoded.rgba), { raw: { width: decoded.width, height: decoded.height, channels: 4 } });
      const filename = `assets/${key.replace(/\.tex$/, "").replaceAll("/", "__")}.png`;
      const { channels } = await image.stats();
      const color = `#${channels.slice(0, 3).map((channel) => Math.round(channel.mean).toString(16).padStart(2, "0")).join("")}`;
      await image.png({ compressionLevel: 9 }).toFile(path.join(output, filename));
      const exported = { filename, width: decoded.width, height: decoded.height, color };
      textures.set(key, exported);
      return exported;
    };

    const turfs: CatalogTurf[] = [];
    const structures: CatalogTurf[] = [];
    for (const definition of included) {
      const atlasKey = resourceKey(definition.atlas!, "levels/tiles", ".xml");
      const sheets = parseAtlasXml((await readResource(atlasKey)).toString("utf8"));
      if (sheets.length !== 1) throw new Error(`Unsupported multi-texture ground atlas: ${atlasKey}`);
      const atlas = await texture(resourceKey(definition.texture!, "levels/tiles", ".tex"));
      const noise = await texture(resourceKey(definition.noise!, "levels/textures", ".tex"));
      const elements: CatalogTurf["elements"] = {};
      for (const element of sheets[0]!.elements) {
        elements[String(Number(element.name))] = uvToRectangle(element, atlas.width, atlas.height);
      }
      if (!elements["1"]) throw new Error(`Missing full tile in ${atlasKey}`);
      for (const element of options.mapping.elements) {
        if (element > 0 && !elements[String(element)]) throw new Error(`Missing edge ${element} in ${atlasKey}`);
      }
      // Dock kits create MONKEY_DOCK via dockmanager, not a turf_* inventory item.
      const inventory = definition.key === "monkey_dock" ? "dock_kit" : definition.inventory;
      const inventoryIcon = definition.key === "monkey_dock" ? "dock_kit" : definition.inventoryIcon;
      const name = inventory ? translations.resolve(inventory) : null;
      if (name?.confidence === "UNMATCHED") throw new Error(`Missing Chinese inventory name: ${definition.inventory}`);
      (definition.key === "monkey_dock" ? structures : turfs).push({
        key: definition.key, label: name?.title ?? "泥土地面（基底）",
        inventory, icon: inventoryIcon ? icons.get(inventoryIcon)! : null,
        renderOrder: definition.renderOrder, flooring: definition.flooring,
        atlas: atlas.filename, noise: noise.filename, color: noise.color, elements,
      });
    }
    if (!turfs.some((turf) => turf.key === "dirt")) throw new Error("Missing native DIRT base");
    const pitchfork = translations.resolve("pitchfork");
    if (pitchfork.confidence === "UNMATCHED") throw new Error("Missing Chinese pitchfork name");
    const catalog: TurfCatalog = {
      format: "dstjs-turf-catalog:v1",
      source: {
        tiledefsSha256: createHash("sha256").update(lua).digest("hex"),
        totalDefinitions: definitions.length, inventoryTurfs: included.filter((tile) => tile.inventory).length,
      },
      base: "dirt", mapping: options.mapping.elements, turfs, structures,
      eraser: { inventory: "pitchfork", label: pitchfork.title, icon: icons.get("pitchfork")!, replacement: "dirt" },
      excluded: definitions.filter((tile) => !included.includes(tile)).map(excludedDefinition),
    };
    await writeFile(path.join(output, "catalog.json"), `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
    await Promise.all([
      writeTurfGrading(source.dataDirectory, output),
      writeTurfOceanAssets(source.dataDirectory, output),
    ]);
    return catalog;
  } finally {
    source.close();
  }
}

function resourceKey(name: string, directory: string, extension: string): string {
  const key = `${name.replace(/\.(tex|xml)$/, "")}${extension}`;
  if (key.includes("..") || path.posix.isAbsolute(key)) throw new Error(`Unsafe ground resource: ${key}`);
  return key.includes("/") ? key : `${directory}/${key}`;
}

function excludedDefinition(tile: VanillaTileDefinition) {
  return { key: tile.key, range: tile.range, reason: tile.range !== "LAND" ? "非陆地地皮" : "无 inventory 地皮物品（特殊/临时地面）" };
}

async function exportInventoryIcons(source: GameAssetSource, wanted: ReadonlySet<string>, output: string): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  // The unnumbered atlas is legacy-for-mods. Vanilla GetInventoryItemAtlas_Internal
  // searches the numbered atlases; mixing both would select stale duplicates.
  for (const key of source.listAtlasKeys().filter((key) => /^images\/inventoryimages\d+\.xml$/.test(key))) {
    for (const sheet of parseAtlasXml((await source.read(key)).toString("utf8"))) {
      const elements = sheet.elements.filter((element) => wanted.has(element.name.replace(/\.tex$/, "")));
      if (!elements.length) continue;
      const decoded = decodeKtex(await source.read(resolveTextureKey(key, sheet.texture)));
      const image = sharp(Buffer.from(decoded.rgba), { raw: { width: decoded.width, height: decoded.height, channels: 4 } });
      for (const element of elements) {
        const code = element.name.replace(/\.tex$/, "");
        if (result.has(code)) throw new Error(`Ambiguous inventory icon: ${code}`);
        const filename = `icons/${code}.png`;
        await image.clone().extract(uvToRectangle(element, decoded.width, decoded.height))
          .png({ compressionLevel: 9 }).toFile(path.join(output, filename));
        result.set(code, filename);
      }
    }
  }
  const missing = [...wanted].filter((code) => !result.has(code));
  if (missing.length) throw new Error(`Missing inventory icons: ${missing.join(", ")}`);
  return result;
}
