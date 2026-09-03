import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { readGameScript } from "../game/scripts.js";
import { GameAssetSource } from "../game/source.js";
import { decodeKtex } from "../texture/ktex.js";

export function parseSeasonColourCubes(lua: string): Record<string, Record<string, string>> {
  const clean = lua.replace(/--[^\n]*/g, "");
  const table = clean.split("local SEASON_COLOURCUBES")[1]?.split("local CAVE_COLOURCUBES")[0];
  if (!table) throw new Error("Missing season colour cube table");
  const result: Record<string, Record<string, string>> = {};
  for (const season of ["spring", "summer", "autumn", "winter"]) {
    const body = table.match(new RegExp(`${season}\\s*=\\s*\\{([^}]+)\\}`))?.[1];
    if (!body) throw new Error(`Missing colour cubes: ${season}`);
    const phases: Record<string, string> = {};
    for (const phase of ["day", "dusk", "night", "full_moon"]) {
      const file = body.match(new RegExp(`\\b${phase}\\s*=\\s*"(images/colour_cubes/[a-zA-Z0-9_]+\\.tex)"`))?.[1];
      if (!file) throw new Error(`Missing colour cube: ${season}/${phase}`);
      phases[phase] = file;
    }
    result[season] = phases;
  }
  return result;
}

export function parsePostProcessorColourCubes(lua: string): {
  identity: string;
  seasons: Record<string, Record<string, string>>;
  insanity: Record<string, string>;
  lunacy: Record<string, string>;
} {
  const clean = lua.replace(/--[^\n]*/g, "");
  const identity = clean.match(/local\s+IDENTITY_COLOURCUBE\s*=\s*"([^"]+\.tex)"/)?.[1];
  if (!identity) throw new Error("Missing identity colour cube");
  const insanityTable = clean.split("local INSANITY_COLOURCUBES")[1]?.split("local LUNACY_COLOURCUBES")[0];
  if (!insanityTable) throw new Error("Missing insanity colour cube table");
  const insanity: Record<string, string> = {};
  for (const phase of ["day", "dusk", "night", "full_moon"]) {
    const file = insanityTable.match(new RegExp(`\\b${phase}\\s*=\\s*"([^"]+\\.tex)"`))?.[1];
    if (!file) throw new Error(`Missing insanity colour cube: ${phase}`);
    insanity[phase] = file;
  }
  const lunacyTable = clean.split("local LUNACY_COLOURCUBES")[1]?.split("local SEASON_COLOURCUBES")[0];
  if (!lunacyTable) throw new Error("Missing lunacy colour cube table");
  const lunacy: Record<string, string> = {};
  for (const phase of ["regular", "full_moon", "moon_storm"]) {
    const file = lunacyTable.match(new RegExp(`\\b${phase}\\s*=\\s*"([^"]+\\.tex)"`))?.[1];
    if (!file) throw new Error(`Missing lunacy colour cube: ${phase}`);
    lunacy[phase] = file;
  }
  return { identity, seasons: parseSeasonColourCubes(lua), insanity, lunacy };
}

export async function writeTurfGrading(dataDirectory: string, outputDirectory: string) {
  const lua = await readGameScript(dataDirectory, "components/colourcube.lua");
  const { identity, seasons, insanity, lunacy } = parsePostProcessorColourCubes(lua);
  const source = await GameAssetSource.open(dataDirectory);
  try {
    await mkdir(path.join(outputDirectory, "grading"), { recursive: true });
    const files = [...new Set([
      identity,
      ...Object.values(seasons).flatMap(phases => Object.values(phases)),
      ...Object.values(insanity),
      ...Object.values(lunacy),
    ])];
    const cubes: Record<string, string> = {};
    for (const file of files) {
      const image = decodeKtex(await source.read(file));
      if (image.width !== 1024 || image.height !== 32) throw new Error(`Unsupported colour cube size: ${file}`);
      // decodeKtex normalizes the texture to top-down rows: x = blue*32+red, y = green.
      const relative = `grading/${path.basename(file, ".tex")}.rgba`;
      await writeFile(path.join(outputDirectory, relative), image.rgba);
      cubes[file] = relative;
    }
    const manifest = { format: "dstjs-turf-grading:v3", dimension: 32,
      sourceSha256: createHash("sha256").update(lua).digest("hex"), identity, seasons, insanity, lunacy, cubes };
    await writeFile(path.join(outputDirectory, "grading.json"), JSON.stringify(manifest, null, 2) + "\n");
    return manifest;
  } finally { source.close(); }
}
