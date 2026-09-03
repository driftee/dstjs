import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

import { animationBounds, openAnimationBundle, renderAnimationFrame } from "../animation/index.js";
import { parseAtlasXml, uvToRectangle } from "../atlas/xml.js";
import { decodeKtex } from "../texture/ktex.js";

export type OceanSpriteSheet = {
  image: string;
  frameWidth: number;
  frameHeight: number;
  frames: number;
  columns: number;
  fps: number;
};

export type TurfOceanManifest = {
  format: "dstjs-turf-ocean:v1";
  paddingTiles: number;
  texture: string;
  falloff: {
    image: string;
    elements: Record<string, { left: number; top: number; width: number; height: number }>;
  };
  dockFalloff?: TurfOceanManifest["falloff"];
  colors: {
    floor: [number, number, number];
    primary: [number, number, number, number];
    secondary: [number, number, number, number];
    waveTint: [number, number, number];
  };
  noiseLayers: Array<{ angle: number; speed: number; scale: number }>;
  waves: {
    shore: OceanSpriteSheet;
    shimmer: OceanSpriteSheet;
  };
};

export async function writeTurfOceanAssets(
  dataDirectory: string,
  outputDirectory: string,
): Promise<TurfOceanManifest> {
  const data = path.resolve(dataDirectory);
  const output = path.resolve(outputDirectory);
  const assets = path.join(output, "assets");
  await mkdir(assets, { recursive: true });

  const noise = decodeKtex(await readFile(path.join(data, "levels/textures/ocean_noise.tex")), { unpremultiplyAlpha: false });
  const texture = "assets/ocean_noise.png";
  await sharp(Buffer.from(noise.rgba), {
    raw: { width: noise.width, height: noise.height, channels: 4 },
  }).resize(768, 768).png({ compressionLevel: 9 }).toFile(path.join(output, texture));

  const falloffDecoded = decodeKtex(await readFile(path.join(data, "levels/tiles/falloff.tex")), { unpremultiplyAlpha: false });
  const falloffImage = "assets/falloff.png";
  await sharp(Buffer.from(falloffDecoded.rgba), {
    raw: { width: falloffDecoded.width, height: falloffDecoded.height, channels: 4 },
  }).png({ compressionLevel: 9 }).toFile(path.join(output, falloffImage));
  const sheets = parseAtlasXml(await readFile(path.join(data, "levels/tiles/falloff.xml"), "utf8"));
  if (sheets.length !== 1) throw new Error("原版 falloff atlas 结构异常");
  const falloffElements = Object.fromEntries(sheets[0]!.elements.map(element => [
    String(Number(element.name)),
    uvToRectangle(element, falloffDecoded.width, falloffDecoded.height),
  ]));

  const dockDecoded = decodeKtex(await readFile(path.join(data, "levels/tiles/dock_falloff.tex")), { unpremultiplyAlpha: false });
  const dockImage = "assets/dock_falloff.png";
  await sharp(Buffer.from(dockDecoded.rgba), {
    raw: { width: dockDecoded.width, height: dockDecoded.height, channels: 4 },
  }).png({ compressionLevel: 9 }).toFile(path.join(output, dockImage));
  const dockSheets = parseAtlasXml(await readFile(path.join(data, "levels/tiles/dock_falloff.xml"), "utf8"));
  if (dockSheets.length !== 1) throw new Error("原版 dock_falloff atlas 结构异常");
  const dockElements = Object.fromEntries(dockSheets[0]!.elements.map(element => [
    String(Number(element.name)), uvToRectangle(element, dockDecoded.width, dockDecoded.height),
  ]));

  const shore = await writeSpriteSheet({
    archive: path.join(data, "anim/wave_shore.zip"),
    animation: "idle_small",
    bank: "wave_shore",
    scale: 0.25,
    frameStep: 2,
    output,
    filename: "assets/wave_shore.png",
  });
  const shimmer = await writeSpriteSheet({
    archive: path.join(data, "anim/wave_shimmer.zip"),
    animation: "idle",
    bank: "shimmer",
    scale: 0.14,
    frameStep: 2,
    maxFrame: 32,
    output,
    filename: "assets/wave_shimmer.png",
  });

  const manifest: TurfOceanManifest = {
    format: "dstjs-turf-ocean:v1",
    paddingTiles: 3,
    texture,
    falloff: { image: falloffImage, elements: falloffElements },
    dockFalloff: { image: dockImage, elements: dockElements },
    colors: {
      floor: [0, 19, 20],
      primary: [220, 255, 255, 28],
      secondary: [25, 123, 167, 100],
      waveTint: [0.8, 0.9, 1],
    },
    noiseLayers: [
      { angle: 15, speed: 0.35, scale: 2.6 },
      { angle: 100, speed: 0.45, scale: 3 },
      { angle: 230, speed: 0.55, scale: 3.4 },
    ],
    waves: { shore, shimmer },
  };
  await writeFile(path.join(output, "ocean.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

async function writeSpriteSheet(options: {
  archive: string;
  animation: string;
  bank: string;
  scale: number;
  frameStep: number;
  maxFrame?: number;
  output: string;
  filename: string;
}): Promise<OceanSpriteSheet> {
  const bundle = await openAnimationBundle(options.archive);
  const animation = bundle.animation.animations.find(candidate =>
    candidate.name === options.animation && candidate.bankName === options.bank);
  if (!animation) throw new Error(`找不到海洋动画 ${options.bank}/${options.animation}`);
  const sourceFrames = Math.min(animation.frames.length, (options.maxFrame ?? animation.frames.length - 1) + 1);
  const indices = Array.from(
    { length: Math.ceil(sourceFrames / options.frameStep) },
    (_, index) => index * options.frameStep,
  );
  const bounds = animationBounds(animation);
  const rendered = await Promise.all(indices.map(frameIndex => renderAnimationFrame(bundle, {
    animation: options.animation,
    bank: options.bank,
    frameIndex,
    scale: options.scale,
    bounds,
    padding: 2,
  })));
  const first = rendered[0];
  if (!first) throw new Error(`海洋动画 ${options.animation} 没有帧`);
  if (!rendered.every(frame => frame.width === first.width && frame.height === first.height)) {
    throw new Error(`海洋动画 ${options.animation} 的帧尺寸不一致`);
  }
  const columns = Math.ceil(Math.sqrt(rendered.length));
  const rows = Math.ceil(rendered.length / columns);
  const sheet = sharp({
    create: {
      width: columns * first.width,
      height: rows * first.height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  });
  await sheet.composite(rendered.map((frame, index) => ({
    input: frame.png,
    left: index % columns * first.width,
    top: Math.floor(index / columns) * first.height,
  }))).png({ compressionLevel: 9 }).toFile(path.join(options.output, options.filename));
  return {
    image: options.filename,
    frameWidth: first.width,
    frameHeight: first.height,
    frames: rendered.length,
    columns,
    fps: animation.frameRate / options.frameStep,
  };
}
