export type VanillaTileDefinition = {
  key: string;
  range: string;
  groundName: string;
  renderOrder: number;
  atlas: string | null;
  texture: string | null;
  noise: string | null;
  inventory: string | null;
  inventoryIcon: string | null;
  flooring: boolean;
};

// A narrow, non-executing parser for vanilla AddTile literal declarations.
// Comments, quoted commas and nested tables must not shift the argument indices.
export function parseVanillaTileDefinitions(source: string): VanillaTileDefinition[] {
  const tokens = source.match(/--\[(=*)\[[\s\S]*?\]\1\]|--[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s]/g) ?? [];
  const clean = tokens.filter((token) => !token.startsWith("--")).join("");
  if (clean.includes("TileManager.ChangeTileRenderOrder(")) {
    throw new Error("Explicit render-order mutations need review before exporting this game version");
  }
  const calls = /TileManager\.AddTile\(/g;
  const result: VanillaTileDefinition[] = [];
  for (let match = calls.exec(clean); match; match = calls.exec(clean)) {
    const start = match.index + match[0].length;
    const end = closingParenthesis(clean, start);
    const args = splitLuaValues(clean.slice(start, end));
    const key = literalString(args[0]);
    if (!key || !/^[A-Z][A-Z0-9_]*$/.test(key)) throw new Error("Non-literal tile key");
    const range = args[1]?.match(/^TileRanges\.([A-Z]+)$/)?.[1];
    if (!range) throw new Error(`Unsupported range for ${key}`);
    const metadata = fields(args[2]);
    const ground = fields(args[3]);
    const turf = fields(args[5]);
    const item = literalString(turf.name);
    const texture = literalString(ground.name);
    const noise = literalString(ground.noise_texture);
    if (args[3] && (!texture || !noise)) throw new Error(`Non-literal ground resources for ${key}`);
    result.push({
      key: key.toLowerCase(), range, groundName: literalString(metadata.ground_name) ?? key,
      renderOrder: result.length,
      texture, atlas: literalString(ground.atlas) ?? texture, noise,
      inventory: item ? `turf_${item}` : null,
      inventoryIcon: item ? `turf_${literalString(turf.invicon_override) ?? item}` : null,
      flooring: ground.flooring === "true",
    });
    calls.lastIndex = end + 1;
  }
  if (!result.length) throw new Error("No vanilla tile definitions found");
  if (new Set(result.map((tile) => tile.key)).size !== result.length) throw new Error("Duplicate tile declarations");
  return result;
}

function literalString(value?: string): string | null {
  if (!value || !/^("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')$/.test(value)) return null;
  return value.slice(1, -1).replace(/\\([\\"'])/g, "$1");
}

function fields(value?: string): Record<string, string> {
  if (!value || value === "nil") return {};
  if (!value.startsWith("{") || !value.endsWith("}")) throw new Error("Expected a literal tile table");
  return Object.fromEntries(splitLuaValues(value.slice(1, -1)).filter(Boolean).map((entry) => {
    const match = entry.match(/^([a-zA-Z_][a-zA-Z0-9_]*)=([\s\S]+)$/);
    if (!match) throw new Error(`Unsupported tile field: ${entry}`);
    return [match[1]!, match[2]!];
  }));
}

function closingParenthesis(source: string, start: number): number {
  let depth = 1;
  let quote = "";
  for (let i = start; i < source.length; i++) {
    const char = source[i];
    if (quote) {
      if (char === "\\") i++;
      else if (char === quote) quote = "";
    } else if (char === '"' || char === "'") quote = char;
    else if (char === "(") depth++;
    else if (char === ")" && --depth === 0) return i;
  }
  throw new Error("Unclosed AddTile call");
}

function splitLuaValues(source: string): string[] {
  const values: string[] = [];
  let start = 0;
  let depth = 0;
  let quote = "";
  for (let i = 0; i < source.length; i++) {
    const char = source[i]!;
    if (quote) {
      if (char === "\\") i++;
      else if (char === quote) quote = "";
    } else if (char === '"' || char === "'") quote = char;
    else if ("({[".includes(char)) depth++;
    else if (")}]".includes(char)) depth--;
    else if (char === "," && depth === 0) { values.push(source.slice(start, i)); start = i + 1; }
  }
  if (quote || depth !== 0) throw new Error("Unbalanced Lua table");
  values.push(source.slice(start));
  return values;
}
