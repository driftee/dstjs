#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { animationBounds, openAnimationBundle, renderAnimationFrame } from "./animation/index.js";
import { extractAtlas, extractAtlasFiles, type AtlasManifest } from "./atlas/extract.js";
import { GameAssetSource } from "./game/source.js";

type Arguments = {
  command: string;
  positional: string[];
  output: string;
  matches: string[];
  texture: string | null;
  animation: string | null;
  bank: string | null;
  frame: number;
  scale: number;
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

  if (arguments_.command === "anim") {
    const [action, archivePath] = arguments_.positional;
    if (!action || !archivePath) return printUsage(1);
    const bundle = await openAnimationBundle(path.resolve(archivePath));
    if (action === "inspect") {
      console.log(JSON.stringify({
        build: bundle.build.name,
        atlases: bundle.build.atlases,
        symbols: bundle.build.symbols.length,
        animations: bundle.animation.animations.map((animation) => ({
          name: animation.name,
          bank: animation.bankName,
          facing: animation.facing,
          frameRate: animation.frameRate,
          frames: animation.frames.length,
          duration: animation.frames.length / animation.frameRate,
        })),
      }, null, 2));
      return;
    }
    if (!arguments_.animation) throw new Error(`${action} 操作需要 --animation`);
    if (action === "frame") {
      const rendered = await renderAnimationFrame(bundle, {
        animation: arguments_.animation,
        bank: arguments_.bank ?? undefined,
        frameIndex: arguments_.frame,
        scale: arguments_.scale,
      });
      const outputPath = path.resolve(arguments_.output.endsWith(".png")
        ? arguments_.output
        : path.join(arguments_.output, `${arguments_.animation}-${arguments_.frame}.png`));
      await mkdir(path.dirname(outputPath), { recursive: true });
      await writeFile(outputPath, rendered.png);
      console.log(`已输出 ${outputPath}（${rendered.width}x${rendered.height}）。`);
      return;
    }
    if (action === "frames") {
      const animation = bundle.animation.animations.find((candidate) =>
        candidate.name === arguments_.animation
        && (arguments_.bank === null || candidate.bankName === arguments_.bank));
      if (!animation) throw new Error(`找不到动画 ${arguments_.animation}`);
      const outputDirectory = path.resolve(arguments_.output);
      const bounds = animationBounds(animation);
      await mkdir(outputDirectory, { recursive: true });
      for (let frameIndex = 0; frameIndex < animation.frames.length; frameIndex += 1) {
        const rendered = await renderAnimationFrame(bundle, {
          animation: arguments_.animation,
          bank: arguments_.bank ?? undefined,
          frameIndex,
          scale: arguments_.scale,
          bounds,
        });
        await writeFile(path.join(outputDirectory, `${frameIndex.toString().padStart(6, "0")}.png`), rendered.png);
      }
      console.log(`已输出 ${animation.frames.length} 帧到 ${outputDirectory}。`);
      return;
    }
    throw new Error(`未知 anim 操作：${action}`);
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
  let animation: string | null = null;
  let bank: string | null = null;
  let frame = 0;
  let scale = 1;
  for (let index = 0; index < rest.length; index += 1) {
    const value = rest[index];
    if (
      value === "--output"
      || value === "--tex"
      || value === "--match"
      || value === "--animation"
      || value === "--bank"
      || value === "--frame"
      || value === "--scale"
    ) {
      const optionValue = rest[index + 1];
      if (!optionValue) throw new Error(`${value} 缺少参数`);
      if (value === "--output") output = optionValue;
      else if (value === "--tex") texture = optionValue;
      else if (value === "--match") matches.push(optionValue);
      else if (value === "--animation") animation = optionValue;
      else if (value === "--bank") bank = optionValue;
      else if (value === "--frame") frame = parseNumberOption(value, optionValue, true);
      else scale = parseNumberOption(value, optionValue, false);
      index += 1;
    } else if (value?.startsWith("--")) {
      throw new Error(`未知参数：${value}`);
    } else if (value) {
      positional.push(value);
    }
  }
  return { command, positional, output, matches, texture, animation, bank, frame, scale };
}

function parseNumberOption(option: string, raw: string, integer: boolean): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || (integer && !Number.isInteger(value))) {
    throw new Error(`${option} 不是有效的${integer ? "非负整数" : "非负数字"}：${raw}`);
  }
  return value;
}

function printUsage(exitCode: number): void {
  console.log(`用法：
  dst atlas <atlas.xml> [--tex <texture.tex>] [--output <目录>]
  dst game <游戏目录或data目录> [--match <名称>]... [--output <目录>]
  dst anim inspect <animation.zip>
  dst anim frame <animation.zip> --animation <名称> [--frame <序号>] [--scale <倍数>] [--output <PNG>]
  dst anim frames <animation.zip> --animation <名称> [--scale <倍数>] [--output <目录>]

示例：
  dst game "/path/to/Don't Starve Together" --match inventoryimages
  dst atlas ./inventoryimages.xml --tex ./inventoryimages.tex
  dst anim inspect ./wet_meter.zip
  dst anim frame ./wet_meter.zip --animation idle --frame 0 --output ./wet-meter.png`);
  process.exitCode = exitCode;
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
