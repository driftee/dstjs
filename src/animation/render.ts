import sharp from "sharp";

import { rasterizeBuildFrame, type RasterizedBuildFrame } from "../sprite-animation/rasterize.js";
import type { AnimationBundle, BuildBundle } from "./archive.js";
import type { Animation, AnimationElement, BuildFrame, BuildSymbol, Rectangle } from "./types.js";

const MAX_RENDER_DIMENSION = 8_192;
const MAX_RENDER_PIXELS = 64 * 1024 * 1024;

export type RenderAnimationFrameOptions = {
  animation: string;
  bank?: string;
  facing?: number;
  frameIndex: number;
  symbolOverrides?: Readonly<Record<string, string>>;
  symbolOverrideBuilds?: readonly BuildBundle[];
  offsetX?: number;
  offsetY?: number;
  scale?: number;
  padding?: number;
  bounds?: Rectangle;
  skipMissingSymbols?: boolean;
  hiddenLayers?: readonly string[];
};

export type RenderedAnimationFrame = {
  png: Buffer;
  width: number;
  height: number;
  animation: Animation;
  frameIndex: number;
};

export type RenderAnimationGifOptions = Omit<RenderAnimationFrameOptions, "frameIndex" | "bounds">;

export type RenderedAnimationGif = {
  gif: Buffer;
  width: number;
  height: number;
  animation: Animation;
  frames: number;
  delay: number;
};

export async function renderAnimationFrame(
  bundle: AnimationBundle,
  options: RenderAnimationFrameOptions,
): Promise<RenderedAnimationFrame> {
  const animation = selectAnimation(bundle, options.animation, options.bank, options.facing);
  if (!Number.isInteger(options.frameIndex) || options.frameIndex < 0 || options.frameIndex >= animation.frames.length) {
    throw new Error(`动画 ${animation.name} 不包含第 ${options.frameIndex} 帧`);
  }
  const scale = options.scale ?? 1;
  const padding = options.padding ?? 2;
  if (!Number.isFinite(scale) || scale <= 0 || scale > 16) throw new Error(`渲染缩放无效：${scale}`);
  if (!Number.isFinite(padding) || padding < 0 || padding > 1_024) throw new Error(`渲染边距无效：${padding}`);

  const frame = animation.frames[options.frameIndex];
  const bounds = options.bounds ?? frame?.bounds;
  if (!frame || !bounds || bounds.width <= 0 || bounds.height <= 0) {
    throw new Error(`动画 ${animation.name} 第 ${options.frameIndex} 帧的边界无效`);
  }
  const viewWidth = bounds.width + padding * 2;
  const viewHeight = bounds.height + padding * 2;
  const outputWidth = Math.max(1, Math.ceil(viewWidth * scale));
  const outputHeight = Math.max(1, Math.ceil(viewHeight * scale));
  if (outputWidth > MAX_RENDER_DIMENSION || outputHeight > MAX_RENDER_DIMENSION
    || outputWidth * outputHeight > MAX_RENDER_PIXELS) {
    throw new Error(`动画输出尺寸 ${outputWidth}x${outputHeight} 超过限制`);
  }
  const left = bounds.x - bounds.width / 2 - padding;
  const top = bounds.y - bounds.height / 2 - padding;
  const symbols = new Map(bundle.build.symbols.map((symbol) => [symbol.hash, symbol]));
  const atlases = bundle.build.atlases.map((atlasName) => {
    const atlas = bundle.atlases.get(atlasName);
    if (!atlas) throw new Error(`找不到 atlas ${atlasName}`);
    return atlas;
  });
  const symbolsByName = new Map<string, { symbol: BuildSymbol; atlases: Parameters<typeof rasterizeBuildFrame>[1] }>(
    bundle.build.symbols.flatMap((symbol) =>
      symbol.name ? [[symbol.name, { symbol, atlases }] as const] : []),
  );
  for (const overrideBuild of options.symbolOverrideBuilds ?? []) {
    const overrideAtlases = overrideBuild.build.atlases.map((atlasName) => {
      const atlas = overrideBuild.atlases.get(atlasName);
      if (!atlas) throw new Error(`找不到 atlas ${atlasName}`);
      return atlas;
    });
    for (const symbol of overrideBuild.build.symbols) {
      if (symbol.name) symbolsByName.set(symbol.name, { symbol, atlases: overrideAtlases });
    }
  }
  const imageCache = new Map<string, Promise<RasterizedSprite>>();
  const hiddenLayers = new Set(options.hiddenLayers ?? []);

  const elements = sortAnimationElementsForDraw(frame.elements)
    .filter((element) => !element.layerName || !hiddenLayers.has(element.layerName));
  const renderedElements: Array<{
    cacheKey: string;
    element: AnimationElement;
    sprite: RasterizedSprite;
  }> = [];
  for (const element of elements) {
    const originalSymbol = symbols.get(element.symbolHash);
    const originalSymbolName = originalSymbol?.name ?? element.symbolName;
    const overrideName = originalSymbolName
      ? options.symbolOverrides?.[originalSymbolName]
      : undefined;
    const overrideSource = overrideName ? symbolsByName.get(overrideName) : undefined;
    const symbol = overrideSource?.symbol ?? originalSymbol;
    if (!symbol || (overrideName && !overrideSource)) {
      if (options.skipMissingSymbols) continue;
      if (overrideName) throw new Error(`Build 中找不到 override symbol ${overrideName}`);
      throw new Error(`Build 中找不到 symbol 0x${element.symbolHash.toString(16)}`);
    }
    const buildFrame = selectBuildFrame(symbol, element.buildFrame, options.skipMissingSymbols);
    if (!buildFrame) continue;
    if (buildFrame.vertices.length === 0) {
      if (options.skipMissingSymbols) continue;
      throw new Error("Build frame 的顶点必须是非空三角形列表");
    }
    const sourceAtlases = overrideSource?.atlases ?? atlases;
    const cacheKey = `${overrideSource ? overrideName : symbol.hash}:${buildFrame.frameNumber}`;
    let image = imageCache.get(cacheKey);
    if (!image) {
      image = renderBuildFrameImage(buildFrame, sourceAtlases);
      imageCache.set(cacheKey, image);
    }
    renderedElements.push({ cacheKey, element, sprite: await image });
  }
  const spriteIds = new Map<string, string>();
  const definitions: string[] = [];
  for (const { cacheKey, sprite } of renderedElements) {
    if (spriteIds.has(cacheKey)) continue;
    const id = `sprite-${spriteIds.size}`;
    spriteIds.set(cacheKey, id);
    definitions.push(
      `<image id="${id}" href="${sprite.source}" width="${sprite.width}" height="${sprite.height}" preserveAspectRatio="none"/>`,
    );
  }

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${outputWidth}" height="${outputHeight}" viewBox="0 0 ${viewWidth} ${viewHeight}">`,
    "<defs>",
    ...definitions,
    "</defs>",
    `<g transform="translate(${-left} ${-top})">`,
    ...renderedElements.map(({ cacheKey, element, sprite }) =>
      imageElement(
        sprite,
        element,
        options.offsetX ?? 0,
        options.offsetY ?? 0,
        spriteIds.get(cacheKey)!,
      )),
    "</g>",
    "</svg>",
  ].join("");
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  return { png, width: outputWidth, height: outputHeight, animation, frameIndex: options.frameIndex };
}

export async function renderAnimationGif(
  bundle: AnimationBundle,
  options: RenderAnimationGifOptions,
): Promise<RenderedAnimationGif> {
  const animation = selectAnimation(bundle, options.animation, options.bank, options.facing);
  const bounds = animationBounds(animation);
  const pages: Buffer[] = [];
  let width = 0;
  let height = 0;
  for (let frameIndex = 0; frameIndex < animation.frames.length; frameIndex += 1) {
    const rendered = await renderAnimationFrame(bundle, {
      ...options,
      frameIndex,
      bounds,
    });
    const { data, info } = await sharp(rendered.png)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (frameIndex === 0) {
      width = info.width;
      height = info.height;
    } else if (info.width !== width || info.height !== height) {
      throw new Error(`动画 ${animation.name} 的帧尺寸不一致`);
    }
    pages.push(data);
  }
  const delay = Math.max(1, Math.round(1000 / animation.frameRate));
  const gif = await sharp(Buffer.concat(pages), {
    raw: {
      width,
      height: height * pages.length,
      channels: 4,
      pageHeight: height,
    },
  }).gif({
    loop: 0,
    delay: Array(pages.length).fill(delay),
  }).toBuffer();
  return { gif, width, height, animation, frames: pages.length, delay };
}

export function sortAnimationElementsForDraw(
  elements: readonly AnimationElement[],
): AnimationElement[] {
  return [...elements].sort((leftElement, rightElement) => rightElement.z - leftElement.z);
}

export function animationBounds(animation: Animation): Rectangle {
  if (animation.frames.length === 0) throw new Error(`动画 ${animation.name} 不包含帧`);
  const left = Math.min(...animation.frames.map((frame) => frame.bounds.x - frame.bounds.width / 2));
  const right = Math.max(...animation.frames.map((frame) => frame.bounds.x + frame.bounds.width / 2));
  const bottom = Math.min(...animation.frames.map((frame) => frame.bounds.y - frame.bounds.height / 2));
  const top = Math.max(...animation.frames.map((frame) => frame.bounds.y + frame.bounds.height / 2));
  if (![left, right, bottom, top].every(Number.isFinite) || right <= left || top <= bottom) {
    throw new Error(`动画 ${animation.name} 的合并边界无效`);
  }
  return {
    x: (left + right) / 2,
    y: (bottom + top) / 2,
    width: right - left,
    height: top - bottom,
  };
}

function selectAnimation(bundle: AnimationBundle, name: string, bank?: string, facing?: number): Animation {
  const matches = bundle.animation.animations.filter((animation) =>
    animation.name === name
    && (bank === undefined || animation.bankName === bank)
    && (facing === undefined || animation.facing === facing));
  if (matches.length === 0) {
    throw new Error(`找不到动画 ${bank ? `${bank}/` : ""}${name}${facing === undefined ? "" : ` facing=${facing}`}`);
  }
  if (matches.length > 1) throw new Error(`动画名 ${name} 不唯一，请指定 bank 或 facing`);
  const animation = matches[0];
  if (!animation) throw new Error(`找不到动画 ${name}`);
  return animation;
}

type RasterizedSprite = RasterizedBuildFrame & {
  source: string;
};

export function selectBuildFrame(
  symbol: BuildSymbol,
  requestedFrame: number,
  skipMissing = false,
): BuildFrame | undefined {
  const orderedFrames = [...symbol.frames].sort((leftFrame, rightFrame) =>
    leftFrame.frameNumber - rightFrame.frameNumber);
  const frame = orderedFrames.find((candidate) =>
    requestedFrame >= candidate.frameNumber
    && requestedFrame < candidate.frameNumber + candidate.duration)
    ?? orderedFrames.filter((candidate) => candidate.frameNumber <= requestedFrame).at(-1);
  if (!frame) {
    if (skipMissing) return undefined;
    throw new Error(`Symbol ${symbol.name ?? `0x${symbol.hash.toString(16)}`} 不包含 build frame ${requestedFrame}`);
  }
  return frame;
}

async function renderBuildFrameImage(
  frame: BuildFrame,
  atlases: Parameters<typeof rasterizeBuildFrame>[1],
): Promise<RasterizedSprite> {
  const rasterized = await rasterizeBuildFrame(frame, atlases, 0);
  return {
    ...rasterized,
    source: `data:image/png;base64,${rasterized.png.toString("base64")}`,
  };
}

function imageElement(
  sprite: RasterizedSprite,
  element: AnimationElement,
  offsetX: number,
  offsetY: number,
  imageId: string,
): string {
  const { a, b, c, d, tx, ty } = element.transform;
  return [
    `<g transform="matrix(${a} ${b} ${c} ${d} ${tx + offsetX} ${ty + offsetY})">`,
    `<use href="#${imageId}" x="${-sprite.originX}" y="${-sprite.originY}"/>`,
    "</g>",
  ].join("");
}
