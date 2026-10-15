import type {
  WebAnimationClip,
  WebAnimationElement,
  WebAnimationManifest,
  WebAnimationScene,
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
  if (value.scene !== undefined) assertScene(value.scene, animations);
  return value as WebAnimationManifest;
}

function assertScene(
  value: unknown,
  animations: Readonly<Record<string, unknown>>,
): asserts value is WebAnimationScene {
  if (!isRecord(value)) throw new Error("Web Animation scene 信息无效");
  assertString(value.rootAnimation, "scene.rootAnimation");
  if (!(value.rootAnimation in animations)) {
    throw new Error(`scene.rootAnimation 引用了不存在的动画 ${value.rootAnimation}`);
  }
  if (!Array.isArray(value.entities)) throw new Error("scene.entities 必须是数组");
  const ids = new Set<string>();
  for (const [index, item] of value.entities.entries()) {
    if (!isRecord(item)) throw new Error(`scene.entities[${index}] 信息无效`);
    assertString(item.id, `scene.entities[${index}].id`);
    if (ids.has(item.id)) throw new Error(`scene entity ID 重复：${item.id}`);
    ids.add(item.id);
    assertString(item.animation, `scene.entities[${index}].animation`);
    if (!(item.animation in animations)) {
      throw new Error(`scene entity ${item.id} 引用了不存在的动画 ${item.animation}`);
    }
    if (!isRecord(item.follow)) throw new Error(`scene entity ${item.id}.follow 信息无效`);
    if (item.follow.layerName === undefined && item.follow.symbolName === undefined) {
      throw new Error(`scene entity ${item.id}.follow 需要 layerName 或 symbolName`);
    }
    if (item.follow.layerName !== undefined) {
      assertString(item.follow.layerName, `${item.id}.follow.layerName`);
    }
    if (item.follow.symbolName !== undefined) {
      assertString(item.follow.symbolName, `${item.id}.follow.symbolName`);
    }
    if (item.follow.buildFrame !== undefined) {
      assertNonNegativeInteger(item.follow.buildFrame, `${item.id}.follow.buildFrame`);
    }
    if (item.follow.occurrence !== undefined) {
      assertNonNegativeInteger(item.follow.occurrence, `${item.id}.follow.occurrence`);
    }
    if (item.follow.x !== undefined) assertFiniteNumber(item.follow.x, `${item.id}.follow.x`);
    if (item.follow.y !== undefined) assertFiniteNumber(item.follow.y, `${item.id}.follow.y`);
    if (item.follow.scale !== undefined) assertPositiveNumber(item.follow.scale, `${item.id}.follow.scale`);
    if (item.zOffset !== undefined) assertFiniteNumber(item.zOffset, `${item.id}.zOffset`);
    if (item.timeOffset !== undefined) assertFiniteNumber(item.timeOffset, `${item.id}.timeOffset`);
  }
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
  if (value.layerName !== undefined) {
    assertString(value.layerName, `动画 ${animationName} 第 ${frameIndex} 帧 layerName`);
  }
  if (value.symbolName !== undefined) {
    assertString(value.symbolName, `动画 ${animationName} 第 ${frameIndex} 帧 symbolName`);
  }
  if (value.buildFrame !== undefined) {
    assertNonNegativeInteger(value.buildFrame, `动画 ${animationName} 第 ${frameIndex} 帧 buildFrame`);
  }
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

function assertNonNegativeInteger(value: unknown, name: string): asserts value is number {
  assertNonNegativeNumber(value, name);
  if (!Number.isInteger(value)) throw new Error(`${name} 必须是整数`);
}

function assertFiniteNumber(value: unknown, name: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${name} 必须是有限数值`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
