import { Buffer } from "node:buffer";
import { access, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { URL } from "node:url";
import sharp from "sharp";

import {
  animationBounds,
  isMirroredEightFacingBit,
  openAnimationBundle,
  openBuildBundle,
  renderAnimationFrame,
} from "../dist/animation/index.js";

const gameAnimRoot = path.join(
  process.argv[2] ?? path.join(
    process.env.HOME,
    "Library/Application Support/Steam/steamapps/common/Don't Starve Together/dontstarve_steam.app/Contents/data/anim",
  ),
);
const outputRoot = path.resolve(
  process.argv[3] ?? path.join(import.meta.dirname, "../output/home-building-animations"),
);
const generatedCatalogPath = path.resolve(
  process.argv[4] ?? path.join(outputRoot, "building-visuals.generated.ts"),
);
const manifest = JSON.parse(await readFile(
  new URL("./home-building-animations.json", import.meta.url),
  "utf8",
));
const animationPixelsPerWorldUnit = manifest.animationPixelsPerWorldUnit;
const buildings = [...manifest.buildings, ...manifest.plants];
const walls = manifest.walls ?? [];

await mkdir(outputRoot, { recursive: true });
const visuals = {};
const stateVisuals = {};
const directionalVisuals = {};
const snowBuild = await openBuildBundle(path.join(gameAnimRoot, "snow.zip"));
for (const building of buildings) {
  const result = await renderBuilding(building, building, `${building.id}.webp`, true);
  await rm(path.join(outputRoot, `${building.id}.png`), { force: true });
  visuals[building.id] = result.visual;
  if (building.states) {
    stateVisuals[building.id] = {};
    for (const state of building.states) {
      const filename = `${building.id}-${state.id}.webp`;
      const stateResult = await renderBuilding(building, state, filename, true);
      stateVisuals[building.id][state.id] = {
        label: state.label,
        image: filename,
        ...stateResult.visual,
      };
    }
  }
}
for (const wall of walls) {
  if (wall.eightFacings) {
    const facings = [];
    const rotatedFacings = [];
    const swingRightFacings = [];
    const swingRightRotatedFacings = [];
    for (let facing = 0; facing < 8; facing += 1) {
      const result = await renderBuilding(
        wall,
        {
          ...wall,
          facingBit: 1 << facing,
        },
        `${wall.id}-facing-${facing}.webp`,
        false,
      );
      facings.push({
        image: `${wall.id}-facing-${facing}.webp`,
        ...result.visual,
      });
      const rotatedResult = await renderBuilding(
        wall,
        {
          ...wall,
          archive: wall.wideArchive,
          facingBit: 1 << facing,
        },
        `${wall.id}-rotated-facing-${facing}.webp`,
        false,
      );
      rotatedFacings.push({
        image: `${wall.id}-rotated-facing-${facing}.webp`,
        ...rotatedResult.visual,
      });
      if (wall.swingRightAnimation) {
        const swingRightResult = await renderBuilding(
          wall,
          {
            ...wall,
            animation: wall.swingRightAnimation,
            facingBit: 1 << facing,
          },
          `${wall.id}-swing-right-facing-${facing}.webp`,
          false,
        );
        swingRightFacings.push({
          image: `${wall.id}-swing-right-facing-${facing}.webp`,
          ...swingRightResult.visual,
        });
        const swingRightRotatedResult = await renderBuilding(
          wall,
          {
            ...wall,
            archive: wall.wideArchive,
            animation: wall.swingRightAnimation,
            facingBit: 1 << facing,
          },
          `${wall.id}-swing-right-rotated-facing-${facing}.webp`,
          false,
        );
        swingRightRotatedFacings.push({
          image: `${wall.id}-swing-right-rotated-facing-${facing}.webp`,
          ...swingRightRotatedResult.visual,
        });
      }
    }
    visuals[wall.id] = facings[0];
    directionalVisuals[wall.id] = {
      facings,
      rotatedFacings,
      ...(swingRightFacings.length > 0
        ? { swingRightFacings, swingRightRotatedFacings }
        : {}),
    };
    continue;
  }
  const cardinalFacing = wall.cardinalFacing ?? 15;
  const diagonalFacing = wall.diagonalFacing ?? 240;
  const cardinal = await renderBuilding(
    wall,
    { ...wall, facing: cardinalFacing },
    `${wall.id}-cardinal.webp`,
    false,
  );
  const diagonal = await renderBuilding(
    wall,
    { ...wall, facing: diagonalFacing },
    `${wall.id}.webp`,
    false,
  );
  visuals[wall.id] = diagonal.visual;
  directionalVisuals[wall.id] = {
    cardinal: {
      image: `${wall.id}-cardinal.webp`,
      ...cardinal.visual,
    },
    diagonal: {
      image: `${wall.id}.webp`,
      ...diagonal.visual,
    },
  };
  if (wall.wideArchive) {
    const rotatedCardinal = await renderBuilding(
      wall,
      { ...wall, archive: wall.wideArchive, facing: cardinalFacing },
      `${wall.id}-rotated-cardinal.webp`,
      false,
    );
    const rotatedDiagonal = await renderBuilding(
      wall,
      { ...wall, archive: wall.wideArchive, facing: diagonalFacing },
      `${wall.id}-rotated-diagonal.webp`,
      false,
    );
    directionalVisuals[wall.id].rotatedCardinal = {
      image: `${wall.id}-rotated-cardinal.webp`,
      ...rotatedCardinal.visual,
    };
    directionalVisuals[wall.id].rotatedDiagonal = {
      image: `${wall.id}-rotated-diagonal.webp`,
      ...rotatedDiagonal.visual,
    };
  }
}
await removeStaleStateFiles();

const generatedCatalog = [
  "// Generated by dstjs/scripts/export-home-building-animations.mjs.",
  "// The anchor is the ANIM world origin within the cropped WebP frame.",
  `export const BUILDING_VISUALS = ${JSON.stringify(visuals, null, 2)} as const;`,
  `export const BUILDING_STATE_VISUALS = ${JSON.stringify(stateVisuals, null, 2)} as const;`,
  `export const BUILDING_DIRECTIONAL_VISUALS = ${JSON.stringify(directionalVisuals, null, 2)} as const;`,
  "",
].join("\n");
await writeFile(generatedCatalogPath, generatedCatalog, "utf8");

async function removeStaleStateFiles() {
  const expected = new Set([
    ...buildings.flatMap(building => [
      `${building.id}.webp`,
      ...(building.states ?? []).map(state => `${building.id}-${state.id}.webp`),
    ]),
    ...walls.flatMap(wall => [
      ...(wall.eightFacings
        ? [
            ...Array.from({ length: 8 }, (_, facing) => `${wall.id}-facing-${facing}.webp`),
            ...Array.from({ length: 8 }, (_, facing) => `${wall.id}-rotated-facing-${facing}.webp`),
            ...(wall.swingRightAnimation
              ? [
                  ...Array.from({ length: 8 }, (_, facing) =>
                    `${wall.id}-swing-right-facing-${facing}.webp`),
                  ...Array.from({ length: 8 }, (_, facing) =>
                    `${wall.id}-swing-right-rotated-facing-${facing}.webp`),
                ]
              : []),
          ]
        : [
            `${wall.id}.webp`,
            `${wall.id}-cardinal.webp`,
          ]),
      ...(!wall.eightFacings && wall.wideArchive
        ? [`${wall.id}-rotated-cardinal.webp`, `${wall.id}-rotated-diagonal.webp`]
        : []),
    ]),
  ]);
  const managedVisualIds = [...manifest.plants, ...walls].map(entry => entry.id);
  for (const filename of await readdir(outputRoot)) {
    if (
      filename.endsWith(".webp")
      && managedVisualIds.some(id => filename === `${id}.webp` || filename.startsWith(`${id}-`))
      && !expected.has(filename)
    ) {
      await rm(path.join(outputRoot, filename));
      process.stdout.write(`删除过期状态 ${filename}\n`);
    }
  }
}

async function renderBuilding(building, variant, filename, skipExisting = false) {
  const archive = variant.archive ?? building.archive;
  const facing = variant.facing ?? building.facing;
  const facingBit = variant.facingBit;
  const bundle = await openAnimationBundle(
    path.join(gameAnimRoot, `${archive}.zip`),
    building.buildArchive
      ? { buildFilename: path.join(gameAnimRoot, `${building.buildArchive}.zip`) }
      : undefined,
  );
  const animation = bundle.animation.animations.find(candidate =>
    candidate.name === variant.animation
    && (
      facingBit !== undefined
        ? (candidate.facing & facingBit) !== 0
        : facing === undefined || candidate.facing === facing
    ));
  if (!animation) throw new Error(`${archive} 中找不到动画 ${variant.animation}`);
  const renderFacing = facingBit !== undefined ? animation.facing : facing;
  // SetEightFaced flips the three left-side facings that share animation records. This engine
  // transform is not stored in anim.bin, even when every facing has its own
  // animation record, as with asymmetric fence gates.
  const mirrorFacing = facingBit !== undefined && isMirroredEightFacingBit(facingBit);

  const frameIndexes = variant.frame === "last"
    ? [animation.frames.length - 1]
    : animation.frames.map((_, frameIndex) => frameIndex);
  const bounds = variant.frame === "last"
    ? animation.frames.at(-1)?.bounds
    : animationBounds(animation);
  if (!bounds) throw new Error(`${archive} 中的动画 ${variant.animation} 没有可导出的帧`);
  const padding = 2;
  const viewWidth = bounds.width + padding * 2;
  const viewHeight = bounds.height + padding * 2;
  const outputPath = path.join(outputRoot, filename);
  const anchorX = (bounds.width / 2 - bounds.x + padding) / viewWidth;
  const visual = {
    visualWidth: viewWidth / animationPixelsPerWorldUnit,
    visualAspectRatio: viewHeight / viewWidth,
    anchorX: mirrorFacing ? 1 - anchorX : anchorX,
    anchorY: (bounds.height / 2 - bounds.y + padding) / viewHeight,
  };
  if (skipExisting && await fileExists(outputPath)) {
    process.stdout.write(`${building.id}/${variant.id ?? "default"}: 复用 ${filename}\n`);
    return { visual };
  }
  const symbolOverrideBuildArchives = variant.symbolOverrideBuildArchives
    ?? building.symbolOverrideBuildArchives
    ?? [];
  const symbolOverrideBuilds = await Promise.all(symbolOverrideBuildArchives.map(name =>
    openBuildBundle(path.join(gameAnimRoot, `${name}.zip`))));
  if (variant.snow) symbolOverrideBuilds.push(snowBuild);
  const pages = [];
  let width = 0;
  let pageHeight = 0;
  for (const frameIndex of frameIndexes) {
    const rendered = await renderAnimationFrame(bundle, {
      animation: variant.animation,
      facing: renderFacing,
      frameIndex,
      bounds,
      skipMissingSymbols: true,
      symbolOverrides: {
        ...(variant.symbolOverrides ?? building.symbolOverrides),
        ...(variant.snow ? { snow: "snow" } : {}),
      },
      symbolOverrideBuilds,
      hiddenLayers: variant.hiddenLayers,
    });
    width = rendered.width;
    pageHeight = rendered.height;
    let frame = sharp(rendered.png).ensureAlpha();
    if (mirrorFacing) frame = frame.flop();
    pages.push(await frame.raw().toBuffer());
  }

  const frameDelay = Math.max(1, Math.round(1000 / animation.frameRate));
  const webp = await sharp(Buffer.concat(pages), {
    raw: { width, height: pageHeight * pages.length, channels: 4, pageHeight },
  }).webp({
    lossless: true,
    effort: 4,
    loop: 0,
    delay: Array(pages.length).fill(frameDelay),
  }).toBuffer();
  await writeFile(outputPath, webp);
  process.stdout.write(
    `${building.id}/${variant.id ?? "default"}: ${variant.animation}, ${animation.frames.length} frames @ ${animation.frameRate} FPS\n`,
  );
  return { visual };
}

async function fileExists(filename) {
  try {
    await access(filename);
    return true;
  } catch {
    return false;
  }
}
