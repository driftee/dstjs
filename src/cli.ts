#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  animationBounds,
  openAnimationBundle,
  openBuildBundle,
  openAnimationFile,
  parseAnimationColour,
  renderAnimationFrame,
  renderAnimationGif,
  type AnimationColour,
} from "./animation/index.js";
import { extractAtlas, extractAtlasFiles, type AtlasManifest } from "./atlas/extract.js";
import { writeCookingCatalog } from "./cooking/index.js";
import {
  GameAssetSource,
  loadChineseTranslations,
  loadModNameTranslations,
  resolveDataDirectory,
} from "./game/index.js";
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
  compileAnimationEntityScenePackage,
  compileWebAnimation,
  createAnimationEntityPlayerHtml,
  createAnimationPlayerHtml,
  parseAnimationEntitySceneConfig,
  type AnimationEntitySceneManifest,
  createPetalSceneHtml,
} from "./web-animation/index.js";
import { formatCliHelp, resolveHelpTopic } from "./cli-help.js";
import { buildManifest } from "./animation/build-manifest.js";

type Arguments = {
  command: string;
  positional: string[];
  output: string;
  matches: string[];
  texture: string | null;
  anim: string | null;
  build: string | null;
  overrideBuilds: string[];
  overrideBuildSymbols: string[];
  animations: string[];
  bank: string | null;
  facing: number | null;
  frame: number;
  scale: number;
  padding: number | null;
  renderPadding: number | null;
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
  cropContent: boolean;
  hiddenLayers: string[];
  hiddenSymbols: string[];
  multColour: AnimationColour | null;
  addColour: AnimationColour | null;
  title: string | null;
  scene: string | null;
};

async function main(): Promise<void> {
  const rawArguments = process.argv.slice(2);
  const helpTopic = resolveHelpTopic(rawArguments);
  if (helpTopic) {
    console.log(formatCliHelp(helpTopic));
    return;
  }
  const arguments_ = parseArguments(rawArguments);
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

  if (arguments_.command === "names") {
    const [action, inputPath, ...codes] = arguments_.positional;
    if (!action || !inputPath || codes.length === 0) return printUsage(1);
    if (action === "resolve") {
      const dataDirectory = await resolveDataDirectory(path.resolve(inputPath));
      const translations = await loadChineseTranslations(dataDirectory);
      console.log(JSON.stringify({
        locale: "zh-CN",
        kind: "base",
        items: codes.map(code => translations.resolveName(code)),
      }, null, 2));
      return;
    }
    if (action === "resolve-mod") {
      const translations = await loadModNameTranslations(path.resolve(inputPath));
      console.log(JSON.stringify({
        locale: "zh-CN",
        kind: "mod",
        items: codes.map(code => translations.resolveName(code)),
      }, null, 2));
      return;
    }
    throw new Error(`未知 names 操作：${action}`);
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
    if (action === "inspect-build") {
      const { build } = await openBuildBundle(path.resolve(arguments_.build ?? animationArchivePath));
      console.log(JSON.stringify(buildManifest(build), null, 2));
      return;
    }
    if (action === "inspect-elements") {
      const animationFile = await openAnimationFile(path.resolve(animationArchivePath));
      const animations = animationFile.animations.filter((animation) =>
        (arguments_.animations.length === 0 || arguments_.animations.includes(animation.name))
        && (arguments_.bank == null || arguments_.bank === animation.bankName)
        && (arguments_.facing == null || arguments_.facing === animation.facing));
      if (animations.length === 0) throw new Error("找不到匹配的动画");
      console.log(JSON.stringify({
        format: "dstjs-animation-elements:v1",
        version: animationFile.version,
        animations,
      }, null, 2));
      return;
    }
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
    const symbolOverrideBuilds = await Promise.all([
      ...arguments_.overrideBuilds.map((filename) => openBuildBundle(path.resolve(filename))),
      ...arguments_.overrideBuildSymbols.map(async (specification) => {
        const separator = specification.lastIndexOf(":");
        if (separator <= 0 || separator === specification.length - 1) {
          throw new Error(`--override-build-symbol 应为 <zip>:<symbol>：${specification}`);
        }
        const filename = specification.slice(0, separator);
        const symbolName = specification.slice(separator + 1);
        const bundle = await openBuildBundle(path.resolve(filename));
        const symbols = bundle.build.symbols.filter((symbol) => symbol.name === symbolName);
        if (symbols.length === 0) {
          throw new Error(`override build ${filename} 中找不到 symbol ${symbolName}`);
        }
        return { ...bundle, build: { ...bundle.build, symbols } };
      }),
    ]);
    if (action === "web") {
      if (arguments_.demo && arguments_.player) throw new Error("--demo 与 --player 不能同时使用");
      if (arguments_.scene && !arguments_.player) throw new Error("--scene 需要同时使用 --player");
      if (arguments_.scene && arguments_.demo) throw new Error("--scene 与 --demo 不能同时使用");
      const outputDirectory = path.resolve(arguments_.output);
      const animationPackage = await compileWebAnimation(bundle, {
        animations: arguments_.animations,
        bank: arguments_.bank ?? undefined,
        facing: arguments_.facing ?? undefined,
        symbolOverrides: parseOverrides(arguments_.overrides),
        symbolOverrideBuilds,
        skipMissingSymbols: arguments_.skipMissingSymbols,
        hiddenLayers: arguments_.hiddenLayers,
        hiddenSymbols: arguments_.hiddenSymbols,
        multColour: arguments_.multColour ?? undefined,
        addColour: arguments_.addColour ?? undefined,
        cropContent: arguments_.cropContent,
        cropAlphaThreshold: arguments_.alphaThreshold,
        cropPadding: arguments_.padding ?? undefined,
      });
      const variantDefinitions = parseVariants(arguments_.variants);
      const variantPackages = arguments_.demo
        ? Object.fromEntries(await Promise.all(variantDefinitions.map(async (variant) => [
          variant.name,
          await compileWebAnimation(bundle, {
            animations: arguments_.animations,
            bank: arguments_.bank ?? undefined,
            facing: arguments_.facing ?? undefined,
            symbolOverrides: variant.symbolOverrides,
            symbolOverrideBuilds,
            skipMissingSymbols: arguments_.skipMissingSymbols,
            hiddenLayers: arguments_.hiddenLayers,
            hiddenSymbols: arguments_.hiddenSymbols,
            multColour: arguments_.multColour ?? undefined,
            addColour: arguments_.addColour ?? undefined,
            cropContent: arguments_.cropContent,
            cropAlphaThreshold: arguments_.alphaThreshold,
            cropPadding: arguments_.padding ?? undefined,
          }),
        ] as const)))
        : {};
      const sceneConfigPath = arguments_.scene ? path.resolve(arguments_.scene) : null;
      const sceneConfig = sceneConfigPath
        ? parseAnimationEntitySceneConfig(JSON.parse(await readFile(sceneConfigPath, "utf8")))
        : null;
      const sceneDirectory = sceneConfigPath ? path.dirname(sceneConfigPath) : process.cwd();
      const compiledEntities = sceneConfig
        ? await Promise.all(sceneConfig.entities.map(async (entity) => {
          const entityBundle = await openAnimationBundle(path.resolve(sceneDirectory, entity.anim), {
            buildFilename: entity.build ? path.resolve(sceneDirectory, entity.build) : undefined,
          });
          return {
            ...entity,
            package: await compileWebAnimation(entityBundle, {
              animations: [entity.animation],
              bank: entity.bank,
              facing: entity.facing,
              skipMissingSymbols: entity.skipMissingSymbols,
              hiddenLayers: entity.hiddenLayers,
              hiddenSymbols: entity.hiddenSymbols,
              cropContent: arguments_.cropContent,
              cropAlphaThreshold: arguments_.alphaThreshold,
              cropPadding: arguments_.padding ?? undefined,
            }),
          };
        }))
        : [];
      const initialAnimation = arguments_.animations[0]
        ?? Object.keys(animationPackage.manifest.animations)[0];
      if (!initialAnimation) throw new Error("Web 动画不包含可播放动作");
      const exportedPackage = sceneConfig
        ? await compileAnimationEntityScenePackage(animationPackage, initialAnimation, compiledEntities)
        : animationPackage;
      const sceneManifest: AnimationEntitySceneManifest | null = sceneConfig ? {
        format: "dstjs-web-animation-scene",
        version: 1,
        root: { manifest: "animation.json", animation: initialAnimation },
        entities: compiledEntities.map((entity) => ({
          id: entity.id,
          manifest: `entities/${entity.id}/animation.json`,
          animation: entity.animation,
          follow: entity.follow,
          zOffset: entity.zOffset ?? 0,
          timeOffset: entity.timeOffset ?? 0,
        })),
      } : null;
      await mkdir(outputDirectory, { recursive: true });
      await Promise.all(compiledEntities.map((entity) =>
        mkdir(path.join(outputDirectory, "entities", entity.id), { recursive: true })));
      await Promise.all([
        writeFile(path.join(outputDirectory, "animation.json"), `${JSON.stringify(exportedPackage.manifest)}\n`, "utf8"),
        writeFile(path.join(outputDirectory, exportedPackage.manifest.atlas.file), exportedPackage.atlas),
        ...compiledEntities.flatMap((entity) => {
          const directory = path.join(outputDirectory, "entities", entity.id);
          return [
            writeFile(path.join(directory, "animation.json"), `${JSON.stringify(entity.package.manifest)}\n`, "utf8"),
            writeFile(path.join(directory, entity.package.manifest.atlas.file), entity.package.atlas),
          ];
        }),
        ...(sceneManifest
          ? [writeFile(path.join(outputDirectory, "scene.json"), `${JSON.stringify(sceneManifest, null, 2)}\n`, "utf8")]
          : []),
        arguments_.demo
          ? writeFile(path.join(outputDirectory, "index.html"), createPetalSceneHtml(animationPackage, {
            variants: variantPackages,
            initialVariant: variantDefinitions[0]?.name,
          }), "utf8")
          : arguments_.player
            ? writeFile(path.join(outputDirectory, "index.html"), sceneConfig
              ? createAnimationEntityPlayerHtml(animationPackage, {
                title: arguments_.title ?? path.basename(animationArchivePath, path.extname(animationArchivePath)),
                initialAnimation,
                entities: compiledEntities,
              })
              : createAnimationPlayerHtml(animationPackage, {
                title: arguments_.title ?? path.basename(animationArchivePath, path.extname(animationArchivePath)),
                initialAnimation,
              }), "utf8")
            : Promise.resolve(),
      ]);
      console.log(`已输出 ${Object.keys(animationPackage.manifest.animations).length} 段 Web 动画到 ${outputDirectory}。`);
      if (sceneConfig) console.log(`多实体场景：${path.join(outputDirectory, "scene.json")}`);
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
        symbolOverrideBuilds,
        skipMissingSymbols: arguments_.skipMissingSymbols,
        hiddenLayers: arguments_.hiddenLayers,
        hiddenSymbols: arguments_.hiddenSymbols,
        multColour: arguments_.multColour ?? undefined,
        addColour: arguments_.addColour ?? undefined,
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
        padding: arguments_.renderPadding ?? undefined,
        animation: animationName,
        bank: arguments_.bank ?? undefined,
        facing: arguments_.facing ?? undefined,
        frameIndex: arguments_.frame,
        symbolOverrides: parseOverrides(arguments_.overrides),
        symbolOverrideBuilds,
        scale: arguments_.scale,
        skipMissingSymbols: arguments_.skipMissingSymbols,
        hiddenLayers: arguments_.hiddenLayers,
        hiddenSymbols: arguments_.hiddenSymbols,
        multColour: arguments_.multColour ?? undefined,
        addColour: arguments_.addColour ?? undefined,
        cropContent: arguments_.cropContent,
        cropAlphaThreshold: arguments_.alphaThreshold,
        cropPadding: arguments_.padding ?? undefined,
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
          hiddenSymbols: arguments_.hiddenSymbols,
          multColour: arguments_.multColour ?? undefined,
          addColour: arguments_.addColour ?? undefined,
        });
        await writeFile(path.join(outputDirectory, `${frameIndex.toString().padStart(6, "0")}.png`), rendered.png);
      }
      console.log(`已输出 ${animation.frames.length} 帧到 ${outputDirectory}。`);
      return;
    }
    if (action === "gif") {
      if (arguments_.multColour && arguments_.multColour[3] !== 1) {
        throw new Error("GIF 不支持半透明 alpha 染色；请使用 anim web、lottie 或 frames");
      }
      const rendered = await renderAnimationGif(bundle, {
        animation: animationName,
        bank: arguments_.bank ?? undefined,
        facing: arguments_.facing ?? undefined,
        symbolOverrides: parseOverrides(arguments_.overrides),
        symbolOverrideBuilds,
        scale: arguments_.scale,
        skipMissingSymbols: arguments_.skipMissingSymbols,
        hiddenLayers: arguments_.hiddenLayers,
        hiddenSymbols: arguments_.hiddenSymbols,
        multColour: arguments_.multColour ?? undefined,
        addColour: arguments_.addColour ?? undefined,
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
  const overrideBuildSymbols: string[] = [];
  const animations: string[] = [];
  let bank: string | null = null;
  let facing: number | null = null;
  let frame = 0;
  let scale = 1;
  let padding: number | null = null;
  let renderPadding: number | null = null;
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
  let cropContent = false;
  const hiddenLayers: string[] = [];
  const hiddenSymbols: string[] = [];
  let multColour: AnimationColour | null = null;
  let addColour: AnimationColour | null = null;
  let title: string | null = null;
  let scene: string | null = null;
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
    if (value === "--crop-content") {
      cropContent = true;
      continue;
    }
    if (
      value === "--output"
      || value === "--tex"
      || value === "--anim"
      || value === "--build"
      || value === "--override-build"
      || value === "--override-build-symbol"
      || value === "--match"
      || value === "--animation"
      || value === "--stage"
      || value === "--bank"
      || value === "--facing"
      || value === "--frame"
      || value === "--scale"
      || value === "--padding"
      || value === "--render-padding"
      || value === "--padding-top"
      || value === "--padding-right"
      || value === "--padding-bottom"
      || value === "--padding-left"
      || value === "--alpha-threshold"
      || value === "--keyframe-mode"
      || value === "--keyframe-tolerance"
      || value === "--hide-layer"
      || value === "--hide-symbol"
      || value === "--mult-colour"
      || value === "--add-colour"
      || value === "--override"
      || value === "--variant"
      || value === "--title"
      || value === "--scene"
    ) {
      const optionValue = rest[index + 1];
      if (!optionValue) throw new Error(`${value} 缺少参数`);
      if (value === "--output") output = optionValue;
      else if (value === "--tex") texture = optionValue;
      else if (value === "--anim") anim = optionValue;
      else if (value === "--build") build = optionValue;
      else if (value === "--override-build") overrideBuilds.push(optionValue);
      else if (value === "--override-build-symbol") overrideBuildSymbols.push(optionValue);
      else if (value === "--match") matches.push(optionValue);
      else if (value === "--animation" || value === "--stage") animations.push(optionValue);
      else if (value === "--bank") bank = optionValue;
      else if (value === "--facing") facing = parseNumberOption(value, optionValue, true);
      else if (value === "--frame") frame = parseNumberOption(value, optionValue, true);
      else if (value === "--scale") scale = parseNumberOption(value, optionValue, false);
      else if (value === "--padding") padding = parseNumberOption(value, optionValue, true);
      else if (value === "--render-padding") {
        renderPadding = parseNumberOption(value, optionValue, true);
        if (renderPadding < 0 || renderPadding > 1_024) throw new Error(`${value} 必须在 0 到 1024 之间`);
      }
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
      else if (value === "--hide-symbol") hiddenSymbols.push(optionValue);
      else if (value === "--mult-colour") multColour = parseAnimationColour(optionValue, value);
      else if (value === "--add-colour") addColour = parseAnimationColour(optionValue, value);
      else if (value === "--override") overrides.push(optionValue);
      else if (value === "--title") title = optionValue;
      else if (value === "--scene") scene = optionValue;
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
    overrideBuildSymbols,
    animations,
    bank,
    facing,
    frame,
    scale,
    padding,
    renderPadding,
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
    cropContent,
    hiddenLayers,
    hiddenSymbols,
    multColour,
    addColour,
    title,
    scene,
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
  console.log(formatCliHelp([]));
  process.exitCode = exitCode;
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
