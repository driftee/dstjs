import sharp from "sharp";

import type { DecodedKtex } from "../texture/ktex.js";
import type { AnimationBundle } from "./archive.js";
import type { Animation, AnimationElement, BuildFrame, BuildSymbol, Rectangle } from "./types.js";

export type RenderAnimationFrameOptions = {
  animation: string;
  bank?: string;
  frameIndex: number;
  scale?: number;
  padding?: number;
  bounds?: Rectangle;
};

export type RenderedAnimationFrame = {
  png: Buffer;
  width: number;
  height: number;
  animation: Animation;
  frameIndex: number;
};

export async function renderAnimationFrame(
  bundle: AnimationBundle,
  options: RenderAnimationFrameOptions,
): Promise<RenderedAnimationFrame> {
  const animation = selectAnimation(bundle, options.animation, options.bank);
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
  const left = bounds.x - bounds.width / 2 - padding;
  const top = bounds.y + bounds.height / 2 + padding;
  const symbols = new Map(bundle.build.symbols.map((symbol) => [symbol.hash, symbol]));
  const imageCache = new Map<string, Promise<string>>();

  const elements = [...frame.elements].sort((leftElement, rightElement) => leftElement.z - rightElement.z);
  const renderedElements = await Promise.all(elements.map(async (element) => {
    const symbol = symbols.get(element.symbolHash);
    if (!symbol) throw new Error(`Build 中找不到 symbol 0x${element.symbolHash.toString(16)}`);
    const buildFrame = selectBuildFrame(symbol, element.buildFrame);
    const cacheKey = `${symbol.hash}:${buildFrame.frameNumber}`;
    let image = imageCache.get(cacheKey);
    if (!image) {
      image = renderBuildFrameImage(bundle, buildFrame);
      imageCache.set(cacheKey, image);
    }
    return imageElement(await image, element, buildFrame);
  }));

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${outputWidth}" height="${outputHeight}" viewBox="0 0 ${viewWidth} ${viewHeight}">`,
    `<g transform="translate(${-left} ${top}) scale(1 -1)">`,
    ...renderedElements,
    "</g>",
    "</svg>",
  ].join("");
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  return { png, width: outputWidth, height: outputHeight, animation, frameIndex: options.frameIndex };
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

function selectAnimation(bundle: AnimationBundle, name: string, bank?: string): Animation {
  const matches = bundle.animation.animations.filter((animation) =>
    animation.name === name && (bank === undefined || animation.bankName === bank));
  if (matches.length === 0) {
    throw new Error(`找不到动画 ${bank ? `${bank}/` : ""}${name}`);
  }
  if (matches.length > 1) throw new Error(`动画名 ${name} 不唯一，请指定 bank`);
  const animation = matches[0];
  if (!animation) throw new Error(`找不到动画 ${name}`);
  return animation;
}

function selectBuildFrame(symbol: BuildSymbol, requestedFrame: number): BuildFrame {
  const frame = symbol.frames.find((candidate) =>
    requestedFrame >= candidate.frameNumber
    && requestedFrame < candidate.frameNumber + candidate.duration);
  if (!frame) {
    throw new Error(`Symbol ${symbol.name ?? `0x${symbol.hash.toString(16)}`} 不包含 build frame ${requestedFrame}`);
  }
  return frame;
}

async function renderBuildFrameImage(bundle: AnimationBundle, frame: BuildFrame): Promise<string> {
  if (frame.vertices.length === 0) throw new Error("Build frame 不包含顶点");
  const atlasIndex = Math.round(frame.vertices[0]?.w ?? -1);
  if (!frame.vertices.every((vertex) => Math.round(vertex.w) === atlasIndex)) {
    throw new Error("Build frame 的顶点跨越多个 atlas");
  }
  const atlasName = bundle.build.atlases[atlasIndex];
  const atlas = atlasName ? bundle.atlases.get(atlasName) : undefined;
  if (!atlasName || !atlas) throw new Error(`找不到 Build frame 使用的 atlas ${atlasIndex}`);

  const rectangle = vertexRectangle(frame, atlas);
  const raw = { width: atlas.width, height: atlas.height, channels: 4 as const };
  const png = await sharp(Buffer.from(atlas.rgba), { raw })
    .extract(rectangle)
    .png()
    .toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}

function vertexRectangle(
  frame: BuildFrame,
  atlas: DecodedKtex,
): { left: number; top: number; width: number; height: number } {
  const minU = Math.min(...frame.vertices.map((vertex) => vertex.u));
  const maxU = Math.max(...frame.vertices.map((vertex) => vertex.u));
  const minV = Math.min(...frame.vertices.map((vertex) => vertex.v));
  const maxV = Math.max(...frame.vertices.map((vertex) => vertex.v));
  const left = Math.max(0, Math.floor(minU * atlas.width));
  const top = Math.max(0, Math.floor((1 - maxV) * atlas.height));
  const right = Math.min(atlas.width, Math.ceil(maxU * atlas.width));
  const bottom = Math.min(atlas.height, Math.ceil((1 - minV) * atlas.height));
  if (right <= left || bottom <= top) throw new Error("Build frame 的 UV 边界无效");
  return { left, top, width: right - left, height: bottom - top };
}

function imageElement(source: string, element: AnimationElement, frame: BuildFrame): string {
  const left = frame.bounds.x - frame.bounds.width / 2;
  const top = frame.bounds.y + frame.bounds.height / 2;
  const { a, b, c, d, tx, ty } = element.transform;
  return [
    `<g transform="matrix(${a} ${c} ${b} ${d} ${tx} ${ty})">`,
    `<image href="${source}" x="${left}" y="${-top}" width="${frame.bounds.width}" height="${frame.bounds.height}" transform="scale(1 -1)" preserveAspectRatio="none"/>`,
    "</g>",
  ].join("");
}
