#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  animationBounds,
  openAnimationBundle,
  openBuildBundle,
  openAnimationFile,
  renderAnimationFrame,
  renderAnimationGif,
} from "./animation/index.js";
import { extractAtlas, extractAtlasFiles, type AtlasManifest } from "./atlas/extract.js";
import { writeCookingCatalog } from "./cooking/index.js";
import { GameAssetSource } from "./game/source.js";
import { pruneTransparentImage, type PruneOutputFormat } from "./image/index.js";
import {
  compileLottiePackage,
  normalizeLottieKeyframeMode,
  stringifyLottieAnimation,
  type LottieKeyframeMode,
} from "./lottie/index.js";
import { compileDstSpriteAnimation } from "./sprite-animation/index.js";
import { convertKtexToPng } from "./texture/index.js";
import {
  captureCoastCalibration,
  captureTurfCalibration,
  deriveTurfEdgeMapping,
  parseTurfCalibrationLog,
  recognizeTurfCaptures,
  recognizeTurfNativeLookup,
  type TurfNativeLookupReport,
  type TurfRecognitionReport,
  writeTurfCalibrationAssets,
  writeTurfSimulator,
  writeTurfCatalog,
  writeModTurfCatalog,
  writeTurfOceanAssets,
} from "./turf/index.js";
import {
  compileWebAnimation,
  createAnimationPlayerHtml,
  createPetalSceneHtml,
} from "./web-animation/index.js";

type Arguments = {
  command: string;
  positional: string[];
  output: string;
  matches: string[];
  texture: string | null;
  anim: string | null;
  build: string | null;
  overrideBuilds: string[];
  animations: string[];
  bank: string | null;
  facing: number | null;
  frame: number;
  scale: number;
  padding: number | null;
  paddingTop: number | null;
  paddingRight: number | null;
  paddingBottom: number | null;
  paddingLeft: number | null;
  alphaThreshold: number;
  overrides: string[];
  variants: string[];
  demo: boolean;
  player: boolean;
  externalImages: boolean;
  keyframeMode: LottieKeyframeMode;
  keyframeTolerance: number;
  skipMissingSymbols: boolean;
  hiddenLayers: string[];
  title: string | null;
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

  if (arguments_.command === "texture") {
    const [action, texturePath] = arguments_.positional;
    if (!action || !texturePath) return printUsage(1);
    if (action !== "decode") throw new Error(`未知 texture 操作：${action}`);
    const sourcePath = path.resolve(texturePath);
    const converted = await convertKtexToPng(await readFile(sourcePath));
    const outputPath = path.resolve(/\.png$/i.test(arguments_.output)
      ? arguments_.output
      : path.join(arguments_.output, `${path.basename(sourcePath, path.extname(sourcePath))}.png`));
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, converted.png);
    console.log(`已输出 ${outputPath}（${converted.width}x${converted.height}，${converted.compression}，${converted.mipmapCount} 个 mipmap）。`);
    return;
  }

  if (arguments_.command === "image") {
    const [action, imagePath] = arguments_.positional;
    if (!action || !imagePath) return printUsage(1);
    if (action !== "prune") throw new Error(`未知 image 操作：${action}`);
    const sourcePath = path.resolve(imagePath);
    const format = pruneOutputFormat(arguments_.output, sourcePath);
    const pruned = await pruneTransparentImage(await readFile(sourcePath), {
      padding: {
        top: arguments_.paddingTop ?? arguments_.padding ?? 0,
        right: arguments_.paddingRight ?? arguments_.padding ?? 0,
        bottom: arguments_.paddingBottom ?? arguments_.padding ?? 0,
        left: arguments_.paddingLeft ?? arguments_.padding ?? 0,
      },
      alphaThreshold: arguments_.alphaThreshold,
      format,
    });
    const outputPath = path.resolve(isImageOutputFile(arguments_.output)
      ? arguments_.output
      : path.join(arguments_.output, `${path.basename(sourcePath, path.extname(sourcePath))}.${format}`));
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, pruned.image);
    const box = pruned.boundingBox
      ? `${pruned.boundingBox.width}x${pruned.boundingBox.height}+${pruned.boundingBox.left}+${pruned.boundingBox.top}`
      : "无非透明像素";
    console.log(`已输出 ${outputPath}（${pruned.inputWidth}x${pruned.inputHeight} -> ${pruned.width}x${pruned.height}，${box}）。`);
    return;
  }

  if (arguments_.command === "cooking") {
    const [action, gamePath] = arguments_.positional;
    if (action !== "catalog" || !gamePath) return printUsage(1);
    const catalog = await writeCookingCatalog({
      gamePath: path.resolve(gamePath),
      outputDirectory: path.resolve(arguments_.output),
    });
    console.log(`已导出 ${catalog.source.ingredientCount} 种食材和 ${catalog.source.recipeCount} 个烹饪配方。`);
    if (catalog.source.missingIcons.length) {
      console.log(`缺少 ${catalog.source.missingIcons.length} 个图标：${catalog.source.missingIcons.join(", ")}`);
    }
    return;
  }

  if (arguments_.command === "turf") {
    const [action, inputPath, secondaryInputPath] = arguments_.positional;
    if (action === "calibration-assets") {
      const outputDirectory = path.resolve(arguments_.output);
      await writeTurfCalibrationAssets(outputDirectory);
      console.log(`已输出地皮校准资源到 ${outputDirectory}。`);
      return;
    }
    if (action === "ocean-assets") {
      if (!inputPath) return printUsage(1);
      const ocean = await writeTurfOceanAssets(inputPath, arguments_.output);
      console.log(`已输出浅海纹理、${ocean.waves.shore.frames} 帧岸浪和 ${ocean.waves.shimmer.frames} 帧海面波光。`);
      return;
    }
    if (action === "parse-log") {
      if (!inputPath) return printUsage(1);
      const result = parseTurfCalibrationLog(await readFile(path.resolve(inputPath), "utf8"));
      const outputPath = path.resolve(arguments_.output.endsWith(".json")
        ? arguments_.output
        : path.join(arguments_.output, "calibration-run.json"));
      await mkdir(path.dirname(outputPath), { recursive: true });
      await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
      console.log(`已输出 ${result.observations.length} 个 mask 到 ${outputPath}，缺少 ${result.missingMasks.length} 个。`);
      return;
    }
    if (action === "capture") {
      const logPath = path.resolve(inputPath ?? path.join(
        os.homedir(),
        "Documents/Klei/DoNotStarveTogether/client_log.txt",
      ));
      const controller = new AbortController();
      const stop = (): void => controller.abort();
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
      try {
        const run = await captureTurfCalibration({
          logPath,
          outputDirectory: path.resolve(arguments_.output),
          signal: controller.signal,
        });
        console.log(`采集结束：${run.captures.length} 张成功，${run.failures.length} 张失败。`);
      } finally {
        process.removeListener("SIGINT", stop);
        process.removeListener("SIGTERM", stop);
      }
      return;
    }
    if (action === "coast-capture") {
      const logPath = path.resolve(inputPath ?? path.join(
        os.homedir(),
        "Documents/Klei/DoNotStarveTogether/client_log.txt",
      ));
      const controller = new AbortController();
      const stop = (): void => controller.abort();
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
      try {
        const run = await captureCoastCalibration({
          logPath,
          outputDirectory: path.resolve(arguments_.output),
          signal: controller.signal,
        });
        console.log(`海岸采集结束：${run.captures.length}/12，失败 ${run.failures.length}。`);
      } finally {
        process.removeListener("SIGINT", stop);
        process.removeListener("SIGTERM", stop);
      }
      return;
    }
    if (action === "recognize") {
      if (!inputPath) return printUsage(1);
      const result = await recognizeTurfCaptures(path.resolve(inputPath));
      const outputPath = path.resolve(arguments_.output.endsWith(".json")
        ? arguments_.output
        : path.join(arguments_.output, "recognition.json"));
      await mkdir(path.dirname(outputPath), { recursive: true });
      await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
      console.log(`已识别 ${result.observations.length} 张截图到 ${outputPath}。`);
      console.log(`数字/条码不一致 ${result.inconsistentCells} 格，低置信度 ${result.lowConfidenceCells} 格。`);
      return;
    }
    if (action === "recognize-native") {
      if (!inputPath) return printUsage(1);
      const result = await recognizeTurfNativeLookup(path.resolve(inputPath));
      const outputPath = path.resolve(arguments_.output.endsWith(".json")
        ? arguments_.output
        : path.join(arguments_.output, "turf-native-lookup.json"));
      await mkdir(path.dirname(outputPath), { recursive: true });
      await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
      console.log(`已输出原生 NINE_SAMPLE 查表到 ${outputPath}。`);
      console.log(`数字/条码不一致 ${result.inconsistentMasks.length} 个，低置信度 ${result.lowConfidenceMasks.length} 个。`);
      return;
    }
    if (action === "derive-mapping") {
      if (!inputPath) return printUsage(1);
      const recognition = JSON.parse(await readFile(path.resolve(inputPath), "utf8")) as TurfRecognitionReport;
      const result = deriveTurfEdgeMapping(recognition);
      const outputPath = path.resolve(arguments_.output.endsWith(".json")
        ? arguments_.output
        : path.join(arguments_.output, "turf-edge-mapping.json"));
      await mkdir(path.dirname(outputPath), { recursive: true });
      await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
      console.log(`已输出地皮边缘映射到 ${outputPath}。`);
      console.log(`验证 ${result.validation.masks} 个 mask、${result.validation.comparisons} 个单元格，冲突 ${result.validation.conflicts} 个。`);
      return;
    }
    if (action === "catalog") {
      if (!inputPath || !secondaryInputPath) return printUsage(1);
      const mapping = JSON.parse(await readFile(path.resolve(secondaryInputPath), "utf8")) as TurfNativeLookupReport;
      const catalog = await writeTurfCatalog({ dataDirectory: inputPath, outputDirectory: arguments_.output, mapping });
      console.log(`已导出 ${catalog.source.inventoryTurfs} 种 inventory 地皮、泥土基底和${catalog.eraser.label}图标。`);
      if (catalog.structures?.length) console.log(`另含 ${catalog.structures.length} 种特殊水上结构（甲板），使用独立画笔与岸沿。`);
      console.log(`单独记录 ${catalog.excluded.length} 种非 inventory 地面，顺序来自游戏 tiledefs.lua。`);
      return;
    }
    if (action === "mod-catalog") {
      const [modDirectory, baseCatalogPath, id, workshopId] = arguments_.positional.slice(1);
      if (!modDirectory || !baseCatalogPath || !id || !workshopId) return printUsage(1);
      const catalog = await writeModTurfCatalog({
        modDirectory,
        baseCatalogPath,
        outputDirectory: arguments_.output,
        id,
        workshopId,
      });
      console.log(`已导出 ${catalog.mod.name} 的 ${catalog.turfs.length} 种地皮，排除 ${catalog.excluded.length} 种特殊地面。`);
      return;
    }
    if (action === "simulator") {
      if (!inputPath || !secondaryInputPath) return printUsage(1);
      const mapping = JSON.parse(await readFile(path.resolve(secondaryInputPath), "utf8")) as TurfNativeLookupReport;
      if (mapping.format !== "dstjs-turf-native-lookup:v1" || mapping.elements.length !== 256) {
        throw new Error("模拟器需要由 recognize-native 生成的 256 项原生查表；旧版方向映射不能用于渲染");
      }
      const outputDirectory = path.resolve(arguments_.output);
      await writeTurfSimulator({
        dataDirectory: path.resolve(inputPath),
        outputDirectory,
        mapping,
      });
      console.log(`已输出地皮模拟器到 ${path.join(outputDirectory, "index.html")}。`);
      return;
    }
    throw new Error(`未知 turf 操作：${action ?? ""}`);
  }

  if (arguments_.command === "anim") {
    const [action, archivePath] = arguments_.positional;
    const animationArchivePath = arguments_.anim ?? archivePath;
    if (!action || !animationArchivePath) return printUsage(1);
    if (action === "inspect") {
      const animationFile = await openAnimationFile(path.resolve(animationArchivePath));
      console.log(JSON.stringify({
        animations: animationFile.animations.map((animation) => ({
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
    const bundle = await openAnimationBundle(path.resolve(animationArchivePath), {
      buildFilename: arguments_.build ? path.resolve(arguments_.build) : undefined,
    });
    const symbolOverrideBuilds = await Promise.all(
      arguments_.overrideBuilds.map((filename) => openBuildBundle(path.resolve(filename))),
    );
    if (action === "web") {
      if (arguments_.demo && arguments_.player) throw new Error("--demo 与 --player 不能同时使用");
      const outputDirectory = path.resolve(arguments_.output);
      const animationPackage = await compileWebAnimation(bundle, {
        animations: arguments_.animations,
        symbolOverrides: parseOverrides(arguments_.overrides),
      });
      const variantDefinitions = parseVariants(arguments_.variants);
      const variantPackages = arguments_.demo
        ? Object.fromEntries(await Promise.all(variantDefinitions.map(async (variant) => [
          variant.name,
          await compileWebAnimation(bundle, {
            animations: arguments_.animations,
            symbolOverrides: variant.symbolOverrides,
          }),
        ] as const)))
        : {};
      await mkdir(outputDirectory, { recursive: true });
      await Promise.all([
        writeFile(path.join(outputDirectory, "animation.json"), `${JSON.stringify(animationPackage.manifest, null, 2)}\n`, "utf8"),
        writeFile(path.join(outputDirectory, animationPackage.manifest.atlas.file), animationPackage.atlas),
        arguments_.demo
          ? writeFile(path.join(outputDirectory, "index.html"), createPetalSceneHtml(animationPackage, {
            variants: variantPackages,
            initialVariant: variantDefinitions[0]?.name,
          }), "utf8")
          : arguments_.player
            ? writeFile(path.join(outputDirectory, "index.html"), createAnimationPlayerHtml(animationPackage, {
              title: arguments_.title ?? path.basename(
                animationArchivePath,
                path.extname(animationArchivePath),
              ),
              initialAnimation: arguments_.animations[0],
            }), "utf8")
          : Promise.resolve(),
      ]);
      console.log(`已输出 ${Object.keys(animationPackage.manifest.animations).length} 段 Web 动画到 ${outputDirectory}。`);
      if (arguments_.demo) console.log(`场景演示：${path.join(outputDirectory, "index.html")}`);
      if (arguments_.player) console.log(`动画播放器：${path.join(outputDirectory, "index.html")}`);
      return;
    }
    if (action === "lottie") {
      const animationName = requireSingleAnimation(arguments_.animations, action);
      const spriteAnimation = await compileDstSpriteAnimation(bundle, {
        animations: [animationName],
        bank: arguments_.bank ?? undefined,
        facing: arguments_.facing ?? undefined,
        symbolOverrides: parseOverrides(arguments_.overrides),
        skipMissingSymbols: arguments_.skipMissingSymbols,
      });
      const lottiePackage = compileLottiePackage(spriteAnimation, {
        clip: animationName,
        padding: arguments_.padding ?? undefined,
        embedImages: !arguments_.externalImages,
        keyframeMode: arguments_.keyframeMode,
        visualTolerance: arguments_.keyframeTolerance,
      });
      const lottie = lottiePackage.animation;
      const outputPath = path.resolve(arguments_.output.endsWith(".json")
        ? arguments_.output
        : path.join(arguments_.output, `${animationName}.lottie.json`));
      await mkdir(path.dirname(outputPath), { recursive: true });
      await Promise.all([
        writeFile(outputPath, `${stringifyLottieAnimation(lottie, 2)}\n`, "utf8"),
        ...[...lottiePackage.images].map(async ([relativePath, image]) => {
          const imagePath = path.join(path.dirname(outputPath), relativePath);
          await mkdir(path.dirname(imagePath), { recursive: true });
          await writeFile(imagePath, image);
        }),
      ]);
      console.log(`已输出 ${outputPath}（${lottie.w}x${lottie.h}，${lottie.op} 帧，${lottie.layers.length} 个图层，${lottiePackage.images.size} 个外置图片）。`);
      return;
    }
    const animationName = requireSingleAnimation(arguments_.animations, action);
    if (action === "frame") {
      const rendered = await renderAnimationFrame(bundle, {
        animation: animationName,
        bank: arguments_.bank ?? undefined,
        facing: arguments_.facing ?? undefined,
        frameIndex: arguments_.frame,
        symbolOverrides: parseOverrides(arguments_.overrides),
        symbolOverrideBuilds,
        scale: arguments_.scale,
        skipMissingSymbols: arguments_.skipMissingSymbols,
        hiddenLayers: arguments_.hiddenLayers,
      });
      const outputPath = path.resolve(arguments_.output.endsWith(".png")
        ? arguments_.output
        : path.join(arguments_.output, `${animationName}-${arguments_.frame}.png`));
      await mkdir(path.dirname(outputPath), { recursive: true });
      await writeFile(outputPath, rendered.png);
      console.log(`已输出 ${outputPath}（${rendered.width}x${rendered.height}）。`);
      return;
    }
    if (action === "frames") {
      const animation = bundle.animation.animations.find((candidate) =>
        candidate.name === animationName
        && (arguments_.bank === null || candidate.bankName === arguments_.bank)
        && (arguments_.facing === null || candidate.facing === arguments_.facing));
      if (!animation) throw new Error(`找不到动画 ${animationName}`);
      const outputDirectory = path.resolve(arguments_.output);
      const bounds = animationBounds(animation);
      await mkdir(outputDirectory, { recursive: true });
      for (let frameIndex = 0; frameIndex < animation.frames.length; frameIndex += 1) {
        const rendered = await renderAnimationFrame(bundle, {
          animation: animationName,
          bank: arguments_.bank ?? undefined,
          facing: arguments_.facing ?? undefined,
          frameIndex,
          symbolOverrides: parseOverrides(arguments_.overrides),
          symbolOverrideBuilds,
          scale: arguments_.scale,
          bounds,
          skipMissingSymbols: arguments_.skipMissingSymbols,
          hiddenLayers: arguments_.hiddenLayers,
        });
        await writeFile(path.join(outputDirectory, `${frameIndex.toString().padStart(6, "0")}.png`), rendered.png);
      }
      console.log(`已输出 ${animation.frames.length} 帧到 ${outputDirectory}。`);
      return;
    }
    if (action === "gif") {
      const rendered = await renderAnimationGif(bundle, {
        animation: animationName,
        bank: arguments_.bank ?? undefined,
        facing: arguments_.facing ?? undefined,
        symbolOverrides: parseOverrides(arguments_.overrides),
        symbolOverrideBuilds,
        scale: arguments_.scale,
        skipMissingSymbols: arguments_.skipMissingSymbols,
        hiddenLayers: arguments_.hiddenLayers,
      });
      const outputPath = path.resolve(arguments_.output.endsWith(".gif")
        ? arguments_.output
        : path.join(arguments_.output, `${animationName}.gif`));
      await mkdir(path.dirname(outputPath), { recursive: true });
      await writeFile(outputPath, rendered.gif);
      console.log(`已输出 ${outputPath}（${rendered.width}x${rendered.height}，${rendered.frames} 帧，${rendered.delay}ms/帧）。`);
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
  let anim: string | null = null;
  let build: string | null = null;
  const overrideBuilds: string[] = [];
  const animations: string[] = [];
  let bank: string | null = null;
  let facing: number | null = null;
  let frame = 0;
  let scale = 1;
  let padding: number | null = null;
  let paddingTop: number | null = null;
  let paddingRight: number | null = null;
  let paddingBottom: number | null = null;
  let paddingLeft: number | null = null;
  let alphaThreshold = 0;
  const overrides: string[] = [];
  const variants: string[] = [];
  let demo = false;
  let player = false;
  let externalImages = false;
  let keyframeMode: LottieKeyframeMode = "lossless";
  let keyframeTolerance = 0.25;
  let skipMissingSymbols = false;
  const hiddenLayers: string[] = [];
  let title: string | null = null;
  for (let index = 0; index < rest.length; index += 1) {
    const value = rest[index];
    if (value === "--demo") {
      demo = true;
      continue;
    }
    if (value === "--player") {
      player = true;
      continue;
    }
    if (value === "--external-images") {
      externalImages = true;
      continue;
    }
    if (value === "--skip-missing-symbols") {
      skipMissingSymbols = true;
      continue;
    }
    if (
      value === "--output"
      || value === "--tex"
      || value === "--anim"
      || value === "--build"
      || value === "--override-build"
      || value === "--match"
      || value === "--animation"
      || value === "--stage"
      || value === "--bank"
      || value === "--facing"
      || value === "--frame"
      || value === "--scale"
      || value === "--padding"
      || value === "--padding-top"
      || value === "--padding-right"
      || value === "--padding-bottom"
      || value === "--padding-left"
      || value === "--alpha-threshold"
      || value === "--keyframe-mode"
      || value === "--keyframe-tolerance"
      || value === "--hide-layer"
      || value === "--override"
      || value === "--variant"
      || value === "--title"
    ) {
      const optionValue = rest[index + 1];
      if (!optionValue) throw new Error(`${value} 缺少参数`);
      if (value === "--output") output = optionValue;
      else if (value === "--tex") texture = optionValue;
      else if (value === "--anim") anim = optionValue;
      else if (value === "--build") build = optionValue;
      else if (value === "--override-build") overrideBuilds.push(optionValue);
      else if (value === "--match") matches.push(optionValue);
      else if (value === "--animation" || value === "--stage") animations.push(optionValue);
      else if (value === "--bank") bank = optionValue;
      else if (value === "--facing") facing = parseNumberOption(value, optionValue, true);
      else if (value === "--frame") frame = parseNumberOption(value, optionValue, true);
      else if (value === "--scale") scale = parseNumberOption(value, optionValue, false);
      else if (value === "--padding") padding = parseNumberOption(value, optionValue, true);
      else if (value === "--padding-top") paddingTop = parseNumberOption(value, optionValue, true);
      else if (value === "--padding-right") paddingRight = parseNumberOption(value, optionValue, true);
      else if (value === "--padding-bottom") paddingBottom = parseNumberOption(value, optionValue, true);
      else if (value === "--padding-left") paddingLeft = parseNumberOption(value, optionValue, true);
      else if (value === "--alpha-threshold") alphaThreshold = parseNumberOption(value, optionValue, true);
      else if (value === "--keyframe-mode") keyframeMode = parseKeyframeMode(optionValue);
      else if (value === "--keyframe-tolerance") {
        keyframeTolerance = parseNumberOption(value, optionValue, false);
        if (keyframeTolerance <= 0) throw new Error(`${value} 必须大于 0`);
      }
      else if (value === "--hide-layer") hiddenLayers.push(optionValue);
      else if (value === "--override") overrides.push(optionValue);
      else if (value === "--title") title = optionValue;
      else variants.push(optionValue);
      index += 1;
    } else if (value?.startsWith("--")) {
      throw new Error(`未知参数：${value}`);
    } else if (value) {
      positional.push(value);
    }
  }
  return {
    command,
    positional,
    output,
    matches,
    texture,
    anim,
    build,
    overrideBuilds,
    animations,
    bank,
    facing,
    frame,
    scale,
    padding,
    paddingTop,
    paddingRight,
    paddingBottom,
    paddingLeft,
    alphaThreshold,
    overrides,
    variants,
    demo,
    player,
    externalImages,
    keyframeMode,
    keyframeTolerance,
    skipMissingSymbols,
    hiddenLayers,
    title,
  };
}

function parseKeyframeMode(raw: string): LottieKeyframeMode {
  if (raw === "0" || raw === "1" || raw === "2") {
    return normalizeLottieKeyframeMode(Number(raw) as 0 | 1 | 2);
  }
  return normalizeLottieKeyframeMode(raw as LottieKeyframeMode);
}

function requireSingleAnimation(animations: string[], action: string): string {
  if (animations.length !== 1) throw new Error(`${action} 操作需要且只接受一个 --animation`);
  const animation = animations[0];
  if (!animation) throw new Error(`${action} 操作需要 --animation`);
  return animation;
}

function parseOverrides(values: string[]): Record<string, string> {
  return Object.fromEntries(values.map((value) => {
    const separator = value.indexOf("=");
    if (separator <= 0 || separator === value.length - 1) {
      throw new Error(`--override 应为 <原 symbol>=<目标 symbol>：${value}`);
    }
    return [value.slice(0, separator), value.slice(separator + 1)];
  }));
}

function parseVariants(values: string[]): Array<{ name: string; symbolOverrides: Record<string, string> }> {
  return values.map((value) => {
    const separator = value.indexOf(":");
    if (separator <= 0 || separator === value.length - 1) {
      throw new Error(`--variant 应为 <名称>:<原 symbol>=<目标 symbol>：${value}`);
    }
    return {
      name: value.slice(0, separator),
      symbolOverrides: parseOverrides([value.slice(separator + 1)]),
    };
  });
}

function parseNumberOption(option: string, raw: string, integer: boolean): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || (integer && !Number.isInteger(value))) {
    throw new Error(`${option} 不是有效的${integer ? "非负整数" : "非负数字"}：${raw}`);
  }
  return value;
}

function pruneOutputFormat(output: string, inputPath: string): PruneOutputFormat {
  const extension = path.extname(isImageOutputFile(output) ? output : inputPath).toLocaleLowerCase();
  if (extension === ".gif") return "gif";
  if (extension === ".png" || !isImageOutputFile(output)) return "png";
  throw new Error(`prune 目前只支持输出 PNG 或 GIF：${output}`);
}

function isImageOutputFile(output: string): boolean {
  return /\.(?:png|gif)$/i.test(output);
}

function printUsage(exitCode: number): void {
  console.log(`用法：
  dst atlas <atlas.xml> [--tex <texture.tex>] [--output <目录>]
  dst game <游戏目录或data目录> [--match <名称>]... [--output <目录>]
  dst image prune <image.png|image.gif> [--padding <像素>] [--padding-top <像素>] [--padding-right <像素>] [--padding-bottom <像素>] [--padding-left <像素>] [--alpha-threshold <0-255>] [--output <PNG/GIF 或目录>]
  dst texture decode <texture.tex> [--output <PNG 或目录>]
  dst cooking catalog <游戏目录或 data 目录> [--output <目录>]
  dst turf calibration-assets [--output <校准 Mod 目录>]
  dst turf ocean-assets <游戏 data 目录> [--output <目录>]
  dst turf parse-log <server_log.txt> [--output <JSON 或目录>]
  dst turf capture [client_log.txt] [--output <截图目录>]
  dst turf coast-capture [client_log.txt] [--output <截图目录>]
  dst turf recognize <截图目录> [--output <JSON 或目录>]
  dst turf recognize-native <新版截图目录> [--output <JSON 或目录>]
  dst turf derive-mapping <识别 JSON> [--output <JSON 或目录>]
  dst turf simulator <游戏 data 目录> <映射 JSON> [--output <目录>]
  dst turf catalog <游戏 data 目录> <原生映射 JSON> [--output <目录>]
  dst turf mod-catalog <模组目录> <原版 catalog.json> <资源包 ID> <Workshop ID> [--output <目录>]
  dst anim inspect <animation.zip> 或 dst anim inspect --anim <anim.zip>
  dst anim frame <animation.zip> --animation <名称> [--build <build.zip>] [--override-build <build.zip>]... [--bank <bank>] [--facing <编号>] [--override <原名=目标名>]... [--hide-layer <名称>]... [--skip-missing-symbols] [--frame <序号>] [--scale <倍数>] [--output <PNG>]
  dst anim frames <animation.zip> --animation <名称> [--build <build.zip>] [--override-build <build.zip>]... [--bank <bank>] [--facing <编号>] [--override <原名=目标名>]... [--hide-layer <名称>]... [--skip-missing-symbols] [--scale <倍数>] [--output <目录>]
  dst anim gif <animation.zip> --animation <名称> [--build <build.zip>] [--override-build <build.zip>]... [--bank <bank>] [--facing <编号>] [--override <原名=目标名>]... [--hide-layer <名称>]... [--skip-missing-symbols] [--scale <倍数>] [--output <GIF>]
  dst anim lottie <animation.zip> --animation <名称> [--build <build.zip>] [--bank <bank>] [--facing <编号>] [--override <原名=目标名>]... [--skip-missing-symbols] [--padding <像素>] [--external-images] [--keyframe-mode <lossless|linear|visual|0|1|2>] [--keyframe-tolerance <像素>] [--output <JSON>]
  dst anim web <animation.zip> [--animation <名称>]... [--build <build.zip>] [--override <原名=目标名>]... [--variant <名称:原名=目标名>]... [--demo | --player] [--title <标题>] [--output <目录>]

示例：
  dst game "/path/to/Don't Starve Together" --match inventoryimages
  dst atlas ./inventoryimages.xml --tex ./inventoryimages.tex
  dst image prune ./output/frame.png --padding 4 --padding-bottom 10 --output ./output/frame-pruned.png
  dst texture decode ./noise_cherrygreen.tex --output ./noise-cherrygreen.png
  dst cooking catalog "/path/to/game/Contents/data" --output ./output/cooking-catalog
  dst turf calibration-assets --output ./examples/dstjs-turf-calibrator
  dst turf ocean-assets "/path/to/game/Contents/data" --output ./output/turf-catalog
  dst turf parse-log ./server_log.txt --output ./calibration-run.json
  dst turf mod-catalog ./workshop/1289779251 ./output/turf-catalog/catalog.json cherry-forest 1289779251 --output ./output/turf-catalog
  dst turf capture --output ./output/turf-captures
  dst turf coast-capture --output ./output/coast-captures
  dst turf recognize ./output/turf-captures --output ./output/turf-recognition.json
  dst turf recognize-native ./output/turf-captures-v2 --output ./output/turf-native-lookup.json
  dst turf derive-mapping ./output/turf-recognition.json --output ./output/turf-edge-mapping.json
  dst turf simulator "/path/to/game/Contents/data" ./output/turf-edge-mapping.json --output ./output/turf-simulator
  dst anim inspect ./wet_meter.zip
  dst anim frame ./wet_meter.zip --animation idle --frame 0 --output ./wet-meter.png
  dst anim inspect --anim ./ds_pig_basic.zip
  dst anim gif --anim ./ds_pig_basic.zip --build ./pig_build.zip --animation idle_loop --facing 8 --hide-layer ARM_carry --hide-layer ARM_carry_up --skip-missing-symbols --output ./pig-idle.gif
  dst anim lottie ./shadow_skittish.zip --animation idle_loop --output ./shadow-skittish.lottie.json
  dst anim lottie ./shadow_skittish.zip --animation idle_loop --external-images --output ./shadow-skittish/animation.json
  dst anim lottie ./shadow_skittish.zip --animation idle_loop --keyframe-mode visual --keyframe-tolerance 0.25 --output ./shadow-skittish-visual.lottie.json
  dst anim web ./shadow_skittish.zip --animation idle_loop --animation disappear --player --title "Mr. Skitts" --output ./mr-skitts
  dst anim web ./cherrytree_petal_fx.zip --override autumn=spring --variant spring:autumn=spring --variant autumn:autumn=autumn --demo --output ./cherry-web`);
  process.exitCode = exitCode;
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
