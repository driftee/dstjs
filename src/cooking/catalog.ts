import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

import { parseAtlasXml, resolveTextureKey, uvToRectangle } from "../atlas/xml.js";
import { readGameScript } from "../game/scripts.js";
import { GameAssetSource } from "../game/source.js";
import { loadChineseTranslations } from "../game/translations.js";
import { decodeKtex } from "../texture/ktex.js";
import { parseCookingExpression, type CookingExpression } from "./expression.js";

export type CookingIngredient = {
  id: string;
  assetCode: string;
  label: string;
  englishLabel: string;
  icon: string | null;
  tags: Record<string, number>;
};

export type CookingRecipe = {
  id: string;
  label: string;
  englishLabel: string;
  icon: string | null;
  cookers: Array<"cookpot" | "portablecookpot">;
  source: "vanilla" | "warly" | "nonfood" | "mod";
  condition: CookingExpression;
  conditionSource: string;
  priority: number;
  weight: number;
  foodType: string | null;
  health: number | null;
  hunger: number | null;
  sanity: number | null;
  perishSeconds: number | null;
  cookTime: number;
  cookSeconds: number;
  example: string[] | null;
};

export type CookingCatalog = {
  format: "dstjs-cooking-catalog:v1";
  source: {
    scriptsSha256: string;
    ingredientCount: number;
    recipeCount: number;
    missingIcons: string[];
  };
  ingredients: CookingIngredient[];
  recipes: CookingRecipe[];
};

const ASSET_ALIASES: Readonly<Record<string, string>> = {
  smallmeat_cooked: "cookedsmallmeat",
  monstermeat_cooked: "cookedmonstermeat",
  meat_cooked: "cookedmeat",
  tomato: "quagmire_tomato",
  tomato_cooked: "quagmire_tomato_cooked",
  onion: "quagmire_onion",
  onion_cooked: "quagmire_onion_cooked",
  egg: "bird_egg",
  egg_cooked: "bird_egg_cooked",
  mandrake_cooked: "cookedmandrake",
};

const BASE_NUMBERS: Readonly<Record<string, number>> = {
  seg_time: 30,
  total_day_time: 480,
  day_time: 300,
  dusk_time: 120,
  night_time: 60,
  calories_per_day: 75,
  perish_warp: 1,
};

/** Export a browser-ready catalog without executing any game Lua. */
export async function writeCookingCatalog(options: {
  gamePath: string;
  outputDirectory: string;
}): Promise<CookingCatalog> {
  const source = await GameAssetSource.open(options.gamePath);
  try {
    const [cookingLua, foodsLua, warlyLua, nonfoodsLua, fishLua, tuningLua, translations] = await Promise.all([
      readGameScript(source.dataDirectory, "cooking.lua"),
      readGameScript(source.dataDirectory, "preparedfoods.lua"),
      readGameScript(source.dataDirectory, "preparedfoods_warly.lua"),
      readGameScript(source.dataDirectory, "preparednonfoods.lua"),
      readGameScript(source.dataDirectory, "prefabs/oceanfishdef.lua"),
      readGameScript(source.dataDirectory, "tuning.lua"),
      loadChineseTranslations(source.dataDirectory),
    ]);
    const ingredientTags = parseIngredients(cookingLua, fishLua);
    const tuning = parseTuningNumbers(tuningLua);
    const baseCookSeconds = tuning.get("BASE_COOK_TIME");
    if (baseCookSeconds === undefined) throw new Error("Missing TUNING.BASE_COOK_TIME");
    const recipeInputs = [
      ...parseRecipes(foodsLua, "vanilla", ["cookpot", "portablecookpot"], tuning, baseCookSeconds),
      ...parseRecipes(warlyLua, "warly", ["portablecookpot"], tuning, baseCookSeconds),
      ...parseRecipes(nonfoodsLua, "nonfood", ["cookpot", "portablecookpot"], tuning, baseCookSeconds),
    ];
    const output = path.resolve(options.outputDirectory);
    await mkdir(path.join(output, "icons", "ingredients"), { recursive: true });
    await mkdir(path.join(output, "icons", "recipes"), { recursive: true });

    const ingredientAssets = new Map(
      [...ingredientTags.keys()].map((id) => [id, ASSET_ALIASES[id] ?? id]),
    );
    const ingredientIcons = await exportInventoryIcons(source, new Set(ingredientAssets.values()), output);
    const recipeIcons = await exportCookbookIcons(source, new Set(recipeInputs.map((recipe) => recipe.id)), output);
    const ingredients = [...ingredientTags.entries()].map(([id, tags]) => {
      const assetCode = ingredientAssets.get(id)!;
      const translation = translations.resolve(assetCode);
      return {
        id,
        assetCode,
        label: translation.title,
        englishLabel: translation.englishTitle,
        icon: ingredientIcons.get(assetCode) ?? null,
        tags,
      };
    }).filter((ingredient) => ingredient.icon !== null)
      .sort((left, right) => left.label.localeCompare(right.label, "zh-CN"));
    const recipes = recipeInputs.map((recipe) => {
      const translation = translations.resolve(recipe.id);
      return {
        ...recipe,
        label: translation.title,
        englishLabel: translation.englishTitle,
        icon: recipeIcons.get(recipe.id) ?? null,
      };
    }).sort((left, right) => left.label.localeCompare(right.label, "zh-CN"));
    const missingIcons = [
      ...ingredients.filter((ingredient) => !ingredient.icon).map((ingredient) => ingredient.assetCode),
      ...recipes.filter((recipe) => !recipe.icon).map((recipe) => recipe.id),
    ];
    const scriptsSha256 = createHash("sha256")
      .update([cookingLua, foodsLua, warlyLua, nonfoodsLua, fishLua, tuningLua].join("\n"))
      .digest("hex");
    const catalog: CookingCatalog = {
      format: "dstjs-cooking-catalog:v1",
      source: {
        scriptsSha256,
        ingredientCount: ingredients.length,
        recipeCount: recipes.length,
        missingIcons,
      },
      ingredients,
      recipes,
    };
    await writeFile(path.join(output, "catalog.json"), `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
    return catalog;
  } finally {
    source.close();
  }
}

export function parseIngredients(cookingLua: string, fishLua = ""): Map<string, Record<string, number>> {
  const source = stripLuaComments(cookingLua);
  const arrays = new Map<string, string[]>();
  for (const match of source.matchAll(/\blocal\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*\{([^{}]*)\}/g)) {
    arrays.set(match[1]!, parseStringList(match[2]!));
  }
  const ingredients = new Map<string, Record<string, number>>();
  for (const call of findCalls(source, "AddIngredientValues")) {
    const arguments_ = splitTopLevel(call);
    const namesSource = arguments_[0]?.trim() ?? "";
    const names = namesSource.startsWith("{")
      ? parseStringList(namesSource.slice(1, -1))
      : arrays.get(namesSource) ?? [];
    const tagsSource = arguments_[1]?.trim() ?? "";
    if (!names.length || !tagsSource.startsWith("{")) continue;
    const tags = parseNumberTable(tagsSource);
    const canCook = arguments_[2]?.trim() === "true";
    const canDry = arguments_[3]?.trim() === "true";
    for (const name of names) {
      ingredients.set(name, { ...tags });
      if (canCook) ingredients.set(`${name}_cooked`, { precook: 1, ...tags });
      if (canDry) ingredients.set(`${name}_dried`, { dried: 1, ...tags });
    }
  }
  addOceanFishIngredients(ingredients, fishLua);
  return ingredients;
}

type RecipeInput = Omit<CookingRecipe, "label" | "englishLabel" | "icon">;

export function parseRecipes(
  lua: string,
  source: CookingRecipe["source"],
  cookers: CookingRecipe["cookers"],
  tuning: ReadonlyMap<string, number>,
  baseCookSeconds = 20,
): RecipeInput[] {
  return parseRecipeTable(
    lua,
    source === "nonfood" ? "items" : "foods",
    source,
    cookers,
    tuning,
    baseCookSeconds,
  );
}

export function parseRecipeTable(
  lua: string,
  tableName: string,
  source: CookingRecipe["source"],
  cookers: CookingRecipe["cookers"],
  tuning: ReadonlyMap<string, number>,
  baseCookSeconds = 20,
): RecipeInput[] {
  const table = findAssignedTable(stripLuaComments(lua), tableName);
  const recipes: RecipeInput[] = [];
  for (const entry of splitTopLevel(table)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*\{([\s\S]*)\}\s*$/.exec(entry);
    if (!match) continue;
    const id = match[1]!;
    const fields = splitFields(match[2]!);
    const test = fields.get("test");
    if (!test) throw new Error(`Missing test for cooking recipe: ${id}`);
    const conditionMatch = /^function\s*\([^)]*\)\s*return\s+([\s\S]*?)\s*end\s*$/.exec(test);
    if (!conditionMatch) throw new Error(`Unsupported test function for cooking recipe: ${id}`);
    const conditionSource = conditionMatch[1]!.trim();
    const cookTime = numberField(fields, "cooktime", tuning) ?? 1;
    recipes.push({
      id,
      source,
      cookers: [...cookers],
      condition: parseCookingExpression(conditionSource),
      conditionSource,
      priority: numberField(fields, "priority", tuning) ?? 0,
      weight: numberField(fields, "weight", tuning) ?? 1,
      foodType: fields.get("foodtype")?.replace(/^FOODTYPE\./, "").trim() ?? null,
      health: numberField(fields, "health", tuning),
      hunger: numberField(fields, "hunger", tuning),
      sanity: numberField(fields, "sanity", tuning),
      perishSeconds: numberField(fields, "perishtime", tuning),
      cookTime,
      cookSeconds: cookTime * baseCookSeconds,
      example: parseRecipeExample(fields.get("card_def")),
    });
  }
  return recipes;
}

function parseRecipeExample(cardDefinition: string | undefined): string[] | null {
  if (!cardDefinition) return null;
  const ingredients: string[] = [];
  for (const match of cardDefinition.matchAll(/\{\s*["']([^"']+)["']\s*,\s*(\d+)\s*\}/g)) {
    for (let count = 0; count < Number(match[2]); count += 1) ingredients.push(match[1]!);
  }
  return ingredients.length === 4 ? ingredients : null;
}

function parseTuningNumbers(lua: string): Map<string, number> {
  const table = findAssignedTable(stripLuaComments(lua), "TUNING");
  const fields = splitFields(table);
  const values = new Map<string, number>(Object.entries(BASE_NUMBERS));
  let changed = true;
  while (changed) {
    changed = false;
    for (const [key, expression] of fields) {
      if (values.has(key)) continue;
      const value = evaluateNumber(expression, values);
      if (value !== null) {
        values.set(key, value);
        changed = true;
      }
    }
  }
  return values;
}

function numberField(
  fields: ReadonlyMap<string, string>,
  key: string,
  tuning: ReadonlyMap<string, number>,
): number | null {
  const expression = fields.get(key);
  if (!expression || expression.trim() === "nil") return null;
  return evaluateNumber(expression, tuning);
}

function evaluateNumber(expression: string, values: ReadonlyMap<string, number>): number | null {
  const normalized = expression
    .replace(/\bTUNING\.([A-Za-z0-9_]+)/g, (_, key: string) => String(values.get(key) ?? `UNKNOWN_${key}`))
    .replace(/\b([A-Za-z_][A-Za-z0-9_]*)\b/g, (name) => String(values.get(name) ?? name));
  if (!/^[\d.\s+\-*/()]+$/.test(normalized)) return null;
  const tokens = normalized.match(/(?:\d+(?:\.\d*)?|\.\d+)|[()+\-*/]/g);
  if (!tokens) return null;
  let index = 0;
  const parsePrimary = (): number => {
    const token = tokens[index++];
    if (token === "(") {
      const value = parseAdditive();
      if (tokens[index++] !== ")") throw new Error("Unclosed numeric expression");
      return value;
    }
    if (token === "-") return -parsePrimary();
    const value = Number(token);
    if (!Number.isFinite(value)) throw new Error("Invalid numeric expression");
    return value;
  };
  const parseMultiplicative = (): number => {
    let value = parsePrimary();
    while (tokens[index] === "*" || tokens[index] === "/") {
      const operator = tokens[index++];
      const right = parsePrimary();
      value = operator === "*" ? value * right : value / right;
    }
    return value;
  };
  const parseAdditive = (): number => {
    let value = parseMultiplicative();
    while (tokens[index] === "+" || tokens[index] === "-") {
      const operator = tokens[index++];
      const right = parseMultiplicative();
      value = operator === "+" ? value + right : value - right;
    }
    return value;
  };
  try {
    const value = parseAdditive();
    return index === tokens.length && Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function addOceanFishIngredients(
  ingredients: Map<string, Record<string, number>>,
  fishLua: string,
): void {
  const constants = new Map<string, Record<string, number>>();
  for (const match of stripLuaComments(fishLua).matchAll(
    /\b(COOKER_INGREDIENT_[A-Z_]+)\s*=\s*(\{[^{}]*\})/g,
  )) {
    constants.set(match[1]!, parseNumberTable(match[2]!));
  }
  for (const match of stripLuaComments(fishLua).matchAll(
    /prefab\s*=\s*"([^"]+)"[\s\S]*?cooker_ingredient_value\s*=\s*(COOKER_INGREDIENT_[A-Z_]+|\{[^{}]*\})/g,
  )) {
    const value = match[2]!;
    const tags = value.startsWith("{") ? parseNumberTable(value) : constants.get(value);
    if (tags) ingredients.set(`${match[1]}_inv`, { ...tags });
  }
}

function splitFields(body: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const field of splitTopLevel(body)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([\s\S]*?)\s*$/.exec(field);
    if (match) result.set(match[1]!, match[2]!);
  }
  return result;
}

function findAssignedTable(source: string, name: string): string {
  const pattern = new RegExp(`\\b(?:local\\s+)?${name}\\s*=\\s*\\{`, "g");
  let selected: string | null = null;
  for (const match of source.matchAll(pattern)) {
    const open = source.indexOf("{", match.index);
    const close = findMatching(source, open, "{", "}");
    const body = source.slice(open + 1, close);
    if (selected === null || body.length > selected.length) selected = body;
    pattern.lastIndex = close + 1;
  }
  if (selected === null) throw new Error(`Missing Lua table: ${name}`);
  return selected;
}

function findCalls(source: string, name: string): string[] {
  const result: string[] = [];
  const pattern = new RegExp(`\\b${name}\\s*\\(`, "g");
  for (const match of source.matchAll(pattern)) {
    const open = source.indexOf("(", match.index);
    const close = findMatching(source, open, "(", ")");
    result.push(source.slice(open + 1, close));
    pattern.lastIndex = close + 1;
  }
  return result;
}

function findMatching(source: string, start: number, open: string, close: string): number {
  let depth = 0;
  let quote = "";
  for (let index = start; index < source.length; index += 1) {
    const character = source[index]!;
    if (quote) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === open) depth += 1;
    else if (character === close && --depth === 0) return index;
  }
  throw new Error(`Unclosed Lua delimiter: ${open}`);
}

function splitTopLevel(source: string): string[] {
  const result: string[] = [];
  let start = 0;
  let quote = "";
  let braces = 0;
  let parentheses = 0;
  let brackets = 0;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!;
    if (quote) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === "'" || character === '"') quote = character;
    else if (character === "{") braces += 1;
    else if (character === "}") braces -= 1;
    else if (character === "(") parentheses += 1;
    else if (character === ")") parentheses -= 1;
    else if (character === "[") brackets += 1;
    else if (character === "]") brackets -= 1;
    else if (character === "," && braces === 0 && parentheses === 0 && brackets === 0) {
      result.push(source.slice(start, index).trim());
      start = index + 1;
    }
  }
  const tail = source.slice(start).trim();
  if (tail) result.push(tail);
  return result.filter(Boolean);
}

function parseStringList(source: string): string[] {
  return [...source.matchAll(/["']([^"']+)["']/g)].map((match) => match[1]!);
}

function parseNumberTable(source: string): Record<string, number> {
  const result: Record<string, number> = {};
  for (const entry of splitTopLevel(source.trim().replace(/^\{|\}$/g, ""))) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(-?(?:\d+(?:\.\d*)?|\.\d+))$/.exec(entry);
    if (!match) throw new Error(`Unsupported ingredient tag: ${entry}`);
    result[match[1]!] = Number(match[2]);
  }
  return result;
}

function stripLuaComments(source: string): string {
  return source
    .replace(/--\[\[[\s\S]*?\]\]/g, "")
    .replace(/--[^\n]*/g, "");
}

async function exportInventoryIcons(
  source: GameAssetSource,
  wanted: ReadonlySet<string>,
  output: string,
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  for (const key of source.listAtlasKeys().filter((key) => /^images\/inventoryimages\d+\.xml$/.test(key))) {
    for (const sheet of parseAtlasXml((await source.read(key)).toString("utf8"))) {
      const elements = sheet.elements.filter((element) => wanted.has(element.name.replace(/\.tex$/, "")));
      if (!elements.length) continue;
      const decoded = decodeKtex(await source.read(resolveTextureKey(key, sheet.texture)));
      const image = sharp(Buffer.from(decoded.rgba), {
        raw: { width: decoded.width, height: decoded.height, channels: 4 },
      });
      for (const element of elements) {
        const code = element.name.replace(/\.tex$/, "");
        if (result.has(code)) continue;
        const filename = `icons/ingredients/${code}.png`;
        await image.clone().extract(uvToRectangle(element, decoded.width, decoded.height))
          .png({ compressionLevel: 9 }).toFile(path.join(output, filename));
        result.set(code, filename);
      }
    }
  }
  return result;
}

async function exportCookbookIcons(
  source: GameAssetSource,
  wanted: ReadonlySet<string>,
  output: string,
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  for (const id of wanted) {
    const key = `images/cookbook_${id}.xml`;
    try {
      const sheets = parseAtlasXml((await source.read(key)).toString("utf8"));
      const sheet = sheets[0];
      const element = sheet?.elements[0];
      if (!sheet || !element) continue;
      const decoded = decodeKtex(await source.read(resolveTextureKey(key, sheet.texture)));
      const filename = `icons/recipes/${id}.png`;
      await sharp(Buffer.from(decoded.rgba), {
        raw: { width: decoded.width, height: decoded.height, channels: 4 },
      }).extract(uvToRectangle(element, decoded.width, decoded.height))
        .png({ compressionLevel: 9 }).toFile(path.join(output, filename));
      result.set(id, filename);
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("找不到游戏资源")) throw error;
    }
  }
  return result;
}
