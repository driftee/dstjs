#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { extractAtlas, extractAtlasFiles, type AtlasManifest } from "./atlas/extract.js";
import { GameAssetSource } from "./game/source.js";

type Arguments = {
  command: string;
  positional: string[];
  output: string;
  matches: string[];
  texture: string | null;
};

async function main(): Promise<void> {
  const arguments_ = parseArguments(process.argv.slice(2));
  if (arguments_.command === "atlas") {
    const xmlPath = arguments_.positional[0];
    if (!xmlPath) return printUsage(1);
    const manifest = await extractAtlasFiles(
      path.resolve(xmlPath),
      arguments_.texture ? path.resolve(arguments_.texture) : null,
      path.resolve(arguments_.output),
    );
    console.log(`已从 ${manifest.atlas} 输出 ${manifest.images.length} 张图片。`);
    return;
  }

  if (arguments_.command === "game") {
    const gamePath = arguments_.positional[0];
    if (!gamePath) return printUsage(1);
    await extractGame(path.resolve(gamePath), path.resolve(arguments_.output), arguments_.matches);
    return;
  }

  printUsage(arguments_.command === "help" ? 0 : 1);
}

async function extractGame(gamePath: string, outputDirectory: string, matches: string[]): Promise<void> {
  const source = await GameAssetSource.open(gamePath);
  const selected = source.listAtlasKeys().filter((key) =>
    matches.length === 0 || matches.some((match) => key.toLocaleLowerCase().includes(match.toLocaleLowerCase())));
  const manifests: AtlasManifest[] = [];
  const failures: Array<{ atlas: string; reason: string }> = [];
  await mkdir(outputDirectory, { recursive: true });

  try {
    for (const [index, atlasKey] of selected.entries()) {
      process.stdout.write(`[${index + 1}/${selected.length}] ${atlasKey} ... `);
      try {
        const manifest = await extractAtlas({
          atlasKey,
          outputDirectory,
          readResource: (key) => source.read(key),
        });
        manifests.push(manifest);
        console.log(`${manifest.images.length} 张`);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        failures.push({ atlas: atlasKey, reason });
        console.log(`失败：${reason}`);
      }
    }
  } finally {
    source.close();
  }

  const report = {
    gamePath,
    dataDirectory: source.dataDirectory,
    generatedAt: new Date().toISOString(),
    selectedAtlases: selected.length,
    successfulAtlases: manifests.length,
    images: manifests.reduce((sum, manifest) => sum + manifest.images.length, 0),
    failures,
  };
  await writeFile(path.join(outputDirectory, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`完成：${report.successfulAtlases}/${report.selectedAtlases} 个 atlas，共 ${report.images} 张图片。`);
  if (failures.length > 0) process.exitCode = 2;
}

function parseArguments(values: string[]): Arguments {
  const [command = "help", ...rest] = values;
  const positional: string[] = [];
  const matches: string[] = [];
  let output = "output";
  let texture: string | null = null;
  for (let index = 0; index < rest.length; index += 1) {
    const value = rest[index];
    if (value === "--output" || value === "--tex" || value === "--match") {
      const optionValue = rest[index + 1];
      if (!optionValue) throw new Error(`${value} 缺少参数`);
      if (value === "--output") output = optionValue;
      else if (value === "--tex") texture = optionValue;
      else matches.push(optionValue);
      index += 1;
    } else if (value?.startsWith("--")) {
      throw new Error(`未知参数：${value}`);
    } else if (value) {
      positional.push(value);
    }
  }
  return { command, positional, output, matches, texture };
}

function printUsage(exitCode: number): void {
  console.log(`用法：
  dst atlas <atlas.xml> [--tex <texture.tex>] [--output <目录>]
  dst game <游戏目录或data目录> [--match <名称>]... [--output <目录>]

示例：
  dst game "/path/to/Don't Starve Together" --match inventoryimages
  dst atlas ./inventoryimages.xml --tex ./inventoryimages.tex`);
  process.exitCode = exitCode;
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
