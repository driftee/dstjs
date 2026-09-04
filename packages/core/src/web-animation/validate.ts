import type {
  WebAnimationClip,
  WebAnimationElement,
  WebAnimationManifest,
  WebAnimationSprite,
} from "./types.js";

export function parseWebAnimationManifest(value: unknown): WebAnimationManifest {
  if (!isRecord(value)) throw new Error("Web Animation manifest 必须是对象");
  if (value.format !== "dstjs-web-animation" || value.version !== 1) {
    throw new Error("不支持的 Web Animation manifest 版本");
  }
  if (!isRecord(value.atlas)) throw new Error("Web Animation atlas 信息无效");
  assertString(value.atlas.file, "atlas.file");
  assertPositiveNumber(value.atlas.width, "atlas.width");
  assertPositiveNumber(value.atlas.height, "atlas.height");
  if (!isRecord(value.sprites)) throw new Error("Web Animation sprites 信息无效");
  if (!isRecord(value.animations)) throw new Error("Web Animation animations 信息无效");

  const sprites = value.sprites as Record<string, unknown>;
  for (const [spriteId, sprite] of Object.entries(sprites)) {
    assertSprite(spriteId, sprite);
  }
  const animations = value.animations as Record<string, unknown>;
  for (const [animationName, clip] of Object.entries(animations)) {
    assertClip(animationName, clip, sprites);
  }
  if (Object.keys(animations).length === 0) {
    throw new Error("Web Animation manifest 不包含动画");
  }
  return value as WebAnimationManifest;
}

function assertSprite(spriteId: string, value: unknown): asserts value is WebAnimationSprite {
  if (!isRecord(value)) throw new Error(`Sprite ${spriteId} 信息无效`);
  assertNonNegativeNumber(value.x, `Sprite ${spriteId}.x`);
  assertNonNegativeNumber(value.y, `Sprite ${spriteId}.y`);
  assertPositiveNumber(value.width, `Sprite ${spriteId}.width`);
  assertPositiveNumber(value.height, `Sprite ${spriteId}.height`);
  assertFiniteNumber(value.originX, `Sprite ${spriteId}.originX`);
  assertFiniteNumber(value.originY, `Sprite ${spriteId}.originY`);
}

function assertClip(
  animationName: string,
  value: unknown,
  sprites: Readonly<Record<string, unknown>>,
): asserts value is WebAnimationClip {
  if (!isRecord(value)) throw new Error(`动画 ${animationName} 信息无效`);
  assertPositiveNumber(value.frameRate, `动画 ${animationName}.frameRate`);
  assertPositiveNumber(value.duration, `动画 ${animationName}.duration`);
  if (!Array.isArray(value.frames) || value.frames.length === 0) {
    throw new Error(`动画 ${animationName} 不包含帧`);
  }
  for (const [frameIndex, frame] of value.frames.entries()) {
    if (!isRecord(frame) || !Array.isArray(frame.elements)) {
      throw new Error(`动画 ${animationName} 第 ${frameIndex} 帧无效`);
    }
    for (const element of frame.elements) {
      assertElement(animationName, frameIndex, element, sprites);
    }
  }
}

function assertElement(
  animationName: string,
  frameIndex: number,
  value: unknown,
  sprites: Readonly<Record<string, unknown>>,
): asserts value is WebAnimationElement {
  if (!isRecord(value)) throw new Error(`动画 ${animationName} 第 ${frameIndex} 帧元素无效`);
  assertString(value.sprite, `动画 ${animationName} 第 ${frameIndex} 帧 sprite`);
  if (!(value.sprite in sprites)) {
    throw new Error(`动画 ${animationName} 第 ${frameIndex} 帧引用了不存在的 Sprite ${value.sprite}`);
  }
  if (
    !Array.isArray(value.transform)
    || value.transform.length !== 6
    || !value.transform.every((part) => typeof part === "number" && Number.isFinite(part))
  ) {
    throw new Error(`动画 ${animationName} 第 ${frameIndex} 帧变换矩阵无效`);
  }
  assertFiniteNumber(value.z, `动画 ${animationName} 第 ${frameIndex} 帧 z`);
}

function assertString(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${name} 无效`);
}

function assertPositiveNumber(value: unknown, name: string): asserts value is number {
  assertFiniteNumber(value, name);
  if (value <= 0) throw new Error(`${name} 必须大于 0`);
}

function assertNonNegativeNumber(value: unknown, name: string): asserts value is number {
  assertFiniteNumber(value, name);
  if (value < 0) throw new Error(`${name} 不能小于 0`);
}

function assertFiniteNumber(value: unknown, name: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${name} 必须是有限数值`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
