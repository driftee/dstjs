import type {
  SpriteAnimationAsset,
  SpriteAnimationClip,
  SpriteAnimationPackage,
  SpriteAnimationRectangle,
  SpriteAnimationTrack,
  SpriteAnimationTrackSample,
} from "../sprite-animation/index.js";
import {
  spriteAnimationTransformChannelsAreExact,
  trackSpriteAnimationClip,
} from "../sprite-animation/index.js";
import type {
  LottieAnimatedProperty,
  LottieAnimation,
  LottieImageAsset,
  LottieImageLayer,
  LottieMarker,
  LottiePackage,
  LottieScalarProperty,
  LottieVectorProperty,
} from "./types.js";

const MATRIX_EPSILON = 1e-5;
const EXACT_VISUAL_TOLERANCE = 1e-4;

export type LottieKeyframeMode = "lossless" | "linear" | "visual";
export type LottieKeyframeModeCode = 0 | 1 | 2;
export type LottieKeyframeModeInput = LottieKeyframeMode | LottieKeyframeModeCode;

export type CompileLottieAnimationOptions = {
  clip?: string;
  padding?: number;
  embedImages?: boolean;
  imageDirectory?: string;
  keyframeMode?: LottieKeyframeModeInput;
  visualTolerance?: number;
};

export function compileLottieAnimation(
  animationPackage: SpriteAnimationPackage,
  options: CompileLottieAnimationOptions = {},
): LottieAnimation {
  return compileLottiePackage(animationPackage, options).animation;
}

export function compileLottiePackage(
  animationPackage: SpriteAnimationPackage,
  options: CompileLottieAnimationOptions = {},
): LottiePackage {
  const clip = selectClip(animationPackage, options.clip);
  const padding = options.padding ?? 2;
  const embedImages = options.embedImages ?? true;
  const imageDirectory = normalizeImageDirectory(options.imageDirectory ?? "images");
  const keyframeMode = normalizeLottieKeyframeMode(options.keyframeMode ?? "lossless");
  const visualTolerance = options.visualTolerance ?? 0.25;
  if (!Number.isFinite(padding) || padding < 0) throw new Error(`Lottie 边距无效：${padding}`);
  if (!Number.isFinite(visualTolerance) || visualTolerance <= 0) {
    throw new Error(`Lottie 视觉误差阈值无效：${visualTolerance}`);
  }
  validateLottieTransforms(clip);
  const bounds = animationBounds(animationPackage, clip);
  const left = bounds.x - bounds.width / 2 - padding;
  const top = bounds.y - bounds.height / 2 - padding;
  const usedSpriteIds = new Set(clip.frames.flatMap((frame) =>
    frame.elements.map((element) => element.spriteId)));
  const images = new Map<string, Buffer>();
  const assets = [...usedSpriteIds].sort().map((spriteId): LottieImageAsset => {
    const asset = animationPackage.document.assets[spriteId];
    if (!asset) throw new Error(`找不到 Sprite ${spriteId}`);
    const image = animationPackage.images.get(spriteId);
    if (!image) throw new Error(`Sprite ${spriteId} 缺少图片数据`);
    if (!embedImages) {
      const filename = `${createHash("sha256").update(image).digest("hex")}.png`;
      images.set(`${imageDirectory}${filename}`, image);
      return {
        id: spriteId,
        w: asset.width,
        h: asset.height,
        u: imageDirectory,
        p: filename,
        e: 0,
      };
    }
    return {
      id: spriteId,
      w: asset.width,
      h: asset.height,
      u: "",
      p: `data:${asset.mimeType};base64,${image.toString("base64")}`,
      e: 1,
    };
  });

  const segments = trackSpriteAnimationClip(clip)
    .flatMap(splitTrack)
    .sort((leftSegment, rightSegment) =>
      rightSegment.drawOrder - leftSegment.drawOrder
      || leftSegment.startFrame - rightSegment.startFrame
      || leftSegment.trackId.localeCompare(rightSegment.trackId));
  const layers = segments.map((segment, index): LottieImageLayer => {
    const asset = animationPackage.document.assets[segment.spriteId];
    if (!asset) throw new Error(`找不到 Sprite ${segment.spriteId}`);
    const transforms = segment.samples.map((sample) => ({
      frame: sample.frame,
      x: sample.transform.channels.position[0],
      y: sample.transform.channels.position[1],
      scaleX: sample.transform.channels.scale[0],
      scaleY: sample.transform.channels.scale[1],
      rotation: sample.transform.channels.rotation,
      skewX: sample.transform.channels.skewX,
    }));
    unwrapTransformAngles(transforms);
    const retainedTransforms = keyframeMode === "lossless"
      ? transforms
      : simplifyTransforms(
        transforms,
        asset,
        keyframeMode === "linear" ? EXACT_VISUAL_TOLERANCE : visualTolerance,
      );
    return {
      ddd: 0,
      ind: index + 1,
      ty: 2,
      nm: `${segment.layerName ?? segment.layerId} · ${segment.trackId}`,
      refId: segment.spriteId,
      sr: 1,
      ks: {
        o: { a: 0, k: 100 },
        r: scalarProperty(retainedTransforms.map((transform) => ({
          frame: transform.frame,
          value: transform.rotation,
        })), keyframeMode),
        p: vectorProperty(retainedTransforms.map((transform) => ({
          frame: transform.frame,
          value: [transform.x - left, transform.y - top, 0],
        })), keyframeMode),
        a: {
          a: 0,
          k: [asset.originX, asset.originY, 0],
        },
        s: vectorProperty(retainedTransforms.map((transform) => ({
          frame: transform.frame,
          value: [transform.scaleX * 100, transform.scaleY * 100, 100],
        })), keyframeMode),
        sk: scalarProperty(retainedTransforms.map((transform) => ({
          frame: transform.frame,
          value: transform.skewX === 0 ? 0 : -transform.skewX,
        })), keyframeMode),
        sa: { a: 0, k: 0 },
      },
      ao: 0,
      ip: segment.startFrame,
      op: segment.endFrame,
      st: 0,
      bm: 0,
    };
  });
  const markers = clip.frames.flatMap((frame, frameIndex) =>
    frame.events.flatMap((event): LottieMarker[] =>
      event.name ? [{ tm: frameIndex, cm: event.name, dr: 0 }] : []));

  return {
    animation: {
      v: "5.7.4",
      fr: clip.frameRate,
      ip: 0,
      op: clip.durationFrames,
      w: Math.max(1, Math.ceil(bounds.width + padding * 2)),
      h: Math.max(1, Math.ceil(bounds.height + padding * 2)),
      nm: clip.name,
      ddd: 0,
      assets,
      layers,
      ...(markers.length > 0 ? { markers } : {}),
    },
    images,
  };
}

export function stringifyLottieAnimation(animation: LottieAnimation, space?: number): string {
  return JSON.stringify(animation, null, space);
}

export function normalizeLottieKeyframeMode(mode: LottieKeyframeModeInput): LottieKeyframeMode {
  if (mode === "lossless" || mode === 0) return "lossless";
  if (mode === "linear" || mode === 1) return "linear";
  if (mode === "visual" || mode === 2) return "visual";
  throw new Error(`未知 Lottie 关键帧模式：${String(mode)}`);
}

function normalizeImageDirectory(directory: string): string {
  const normalized = directory.replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
  if (!normalized || normalized === "." || normalized.split("/").includes("..")) {
    throw new Error(`Lottie 图片目录无效：${directory}`);
  }
  return `${normalized}/`;
}

type TrackSegment = {
  trackId: string;
  layerId: string;
  layerName: string | null;
  spriteId: string;
  drawOrder: number;
  startFrame: number;
  endFrame: number;
  samples: SpriteAnimationTrackSample[];
};

type TransformSample = {
  frame: number;
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  skewX: number;
};

function splitTrack(track: SpriteAnimationTrack): TrackSegment[] {
  const segments: TrackSegment[] = [];
  let active: TrackSegment | null = null;
  for (const sample of track.samples) {
    if (
      !sample
      || !active
      || active.spriteId !== sample.spriteId
      || active.drawOrder !== sample.drawOrder
      || active.endFrame !== sample.frame
    ) {
      if (active) segments.push(active);
      active = sample ? createSegment(track, sample) : null;
      continue;
    }
    active.samples.push(sample);
    active.endFrame = sample.frame + 1;
  }
  if (active) segments.push(active);
  return segments;
}

function createSegment(
  track: SpriteAnimationTrack,
  sample: SpriteAnimationTrackSample,
): TrackSegment {
  return {
    trackId: track.id,
    layerId: track.layerId,
    layerName: track.layerName,
    spriteId: sample.spriteId,
    drawOrder: sample.drawOrder,
    startFrame: sample.frame,
    endFrame: sample.frame + 1,
    samples: [sample],
  };
}

function scalarProperty(
  samples: Array<{ frame: number; value: number }>,
  mode: LottieKeyframeMode,
): LottieScalarProperty {
  const first = samples[0];
  if (!first) throw new Error("Lottie 图层不包含变换采样");
  if (samples.every((sample) => nearlyEqual(sample.value, first.value))) {
    return { a: 0, k: first.value };
  }
  return animatedProperty(samples.map((sample) => ({
    frame: sample.frame,
    value: [sample.value] as [number],
  })), mode);
}

function vectorProperty(
  samples: Array<{ frame: number; value: [number, number, number] }>,
  mode: LottieKeyframeMode,
): LottieVectorProperty {
  const first = samples[0];
  if (!first) throw new Error("Lottie 图层不包含变换采样");
  if (samples.every((sample) => vectorNearlyEqual(sample.value, first.value))) {
    return { a: 0, k: first.value };
  }
  return animatedProperty(samples, mode);
}

function animatedProperty<T extends [number] | [number, number, number]>(
  samples: Array<{ frame: number; value: T }>,
  mode: LottieKeyframeMode,
): LottieAnimatedProperty<T> {
  if (mode !== "lossless") {
    const simplifiedSamples = simplifyPropertySamples(samples);
    return {
      a: 1,
      k: simplifiedSamples.map((sample, index) => {
        const next = simplifiedSamples[index + 1];
        if (!next) return { t: sample.frame, s: sample.value };
        return {
          t: sample.frame,
          s: sample.value,
          o: {
            x: 0,
            y: 0,
          },
          i: {
            x: 1,
            y: 1,
          },
        };
      }),
    };
  }
  const keyframes: LottieAnimatedProperty<T>["k"] = [];
  let previous: T | undefined;
  for (const sample of samples) {
    if (previous && vectorNearlyEqual(previous, sample.value)) continue;
    keyframes.push({ t: sample.frame, s: sample.value, h: 1 });
    previous = sample.value;
  }
  return { a: 1, k: keyframes };
}

function simplifyPropertySamples<T extends readonly number[]>(
  samples: Array<{ frame: number; value: T }>,
): Array<{ frame: number; value: T }> {
  if (samples.length <= 2) return samples;
  const retained = new Set([0, samples.length - 1]);
  simplifyPropertyRange(samples, 0, samples.length - 1, retained);
  return [...retained].sort((left, right) => left - right).map((index) => samples[index]!);
}

function simplifyPropertyRange<T extends readonly number[]>(
  samples: Array<{ frame: number; value: T }>,
  startIndex: number,
  endIndex: number,
  retained: Set<number>,
): void {
  if (endIndex - startIndex <= 1) return;
  const start = samples[startIndex];
  const end = samples[endIndex];
  if (!start || !end) return;
  let largestError = -1;
  let largestErrorIndex = -1;
  for (let index = startIndex + 1; index < endIndex; index += 1) {
    const sample = samples[index];
    if (!sample) continue;
    const progress = (sample.frame - start.frame) / (end.frame - start.frame);
    const error = sample.value.reduce((maximum, value, dimension) => Math.max(
      maximum,
      Math.abs(value - interpolate(
        start.value[dimension] ?? 0,
        end.value[dimension] ?? 0,
        progress,
      )),
    ), 0);
    if (error > largestError) {
      largestError = error;
      largestErrorIndex = index;
    }
  }
  if (largestError <= MATRIX_EPSILON || largestErrorIndex < 0) return;
  retained.add(largestErrorIndex);
  simplifyPropertyRange(samples, startIndex, largestErrorIndex, retained);
  simplifyPropertyRange(samples, largestErrorIndex, endIndex, retained);
}

function unwrapTransformAngles(samples: TransformSample[]): void {
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    if (!previous || !current) continue;
    current.rotation = unwrapAngle(current.rotation, previous.rotation);
    current.skewX = unwrapAngle(current.skewX, previous.skewX);
  }
}

function unwrapAngle(angle: number, previous: number): number {
  while (angle - previous > 180) angle -= 360;
  while (angle - previous < -180) angle += 360;
  return angle;
}

function simplifyTransforms(
  samples: readonly TransformSample[],
  asset: SpriteAnimationAsset,
  tolerance: number,
): TransformSample[] {
  if (samples.length <= 2) return [...samples];
  const retained = new Set([0, samples.length - 1]);
  simplifyRange(samples, asset, tolerance, 0, samples.length - 1, retained);
  return [...retained].sort((left, right) => left - right).map((index) => samples[index]!);
}

function simplifyRange(
  samples: readonly TransformSample[],
  asset: SpriteAnimationAsset,
  tolerance: number,
  startIndex: number,
  endIndex: number,
  retained: Set<number>,
): void {
  if (endIndex - startIndex <= 1) return;
  const start = samples[startIndex];
  const end = samples[endIndex];
  if (!start || !end) return;
  let largestError = -1;
  let largestErrorIndex = -1;
  for (let index = startIndex + 1; index < endIndex; index += 1) {
    const sample = samples[index];
    if (!sample) continue;
    const progress = (sample.frame - start.frame) / (end.frame - start.frame);
    const interpolated = interpolateTransform(start, end, progress);
    const error = transformedSpriteError(sample, interpolated, asset);
    if (error > largestError) {
      largestError = error;
      largestErrorIndex = index;
    }
  }
  if (largestError <= tolerance || largestErrorIndex < 0) return;
  retained.add(largestErrorIndex);
  simplifyRange(samples, asset, tolerance, startIndex, largestErrorIndex, retained);
  simplifyRange(samples, asset, tolerance, largestErrorIndex, endIndex, retained);
}

function interpolateTransform(
  start: TransformSample,
  end: TransformSample,
  progress: number,
): TransformSample {
  return {
    frame: start.frame + (end.frame - start.frame) * progress,
    x: interpolate(start.x, end.x, progress),
    y: interpolate(start.y, end.y, progress),
    scaleX: interpolate(start.scaleX, end.scaleX, progress),
    scaleY: interpolate(start.scaleY, end.scaleY, progress),
    rotation: interpolate(start.rotation, end.rotation, progress),
    skewX: interpolate(start.skewX, end.skewX, progress),
  };
}

function transformedSpriteError(
  actual: TransformSample,
  predicted: TransformSample,
  asset: SpriteAnimationAsset,
): number {
  const corners = [
    [-asset.originX, -asset.originY],
    [asset.width - asset.originX, -asset.originY],
    [-asset.originX, asset.height - asset.originY],
    [asset.width - asset.originX, asset.height - asset.originY],
  ];
  let maximum = 0;
  for (const [x = 0, y = 0] of corners) {
    const actualPoint = transformPoint(actual, x, y);
    const predictedPoint = transformPoint(predicted, x, y);
    maximum = Math.max(maximum, Math.hypot(
      actualPoint.x - predictedPoint.x,
      actualPoint.y - predictedPoint.y,
    ));
  }
  return maximum;
}

function transformPoint(transform: TransformSample, x: number, y: number): {
  x: number;
  y: number;
} {
  const radians = transform.rotation * Math.PI / 180;
  const skew = Math.tan(transform.skewX * Math.PI / 180);
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return {
    x: transform.x
      + cosine * transform.scaleX * x
      + transform.scaleY * (cosine * skew - sine) * y,
    y: transform.y
      + sine * transform.scaleX * x
      + transform.scaleY * (sine * skew + cosine) * y,
  };
}

function interpolate(start: number, end: number, progress: number): number {
  return start + (end - start) * progress;
}

function vectorNearlyEqual(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length
    && left.every((value, index) => nearlyEqual(value, right[index] ?? NaN));
}

function nearlyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= MATRIX_EPSILON;
}

function selectClip(animationPackage: SpriteAnimationPackage, name?: string): SpriteAnimationClip {
  if (name) {
    const matches = animationPackage.document.clips.filter((clip) =>
      clip.id === name || clip.name === name);
    if (matches.length === 0) throw new Error(`找不到动画 ${name}`);
    if (matches.length > 1) throw new Error(`动画名 ${name} 不唯一，请使用 clip ID`);
    const clip = matches[0];
    if (clip) return clip;
  }
  if (animationPackage.document.clips.length !== 1) {
    throw new Error("动画包包含多个动画，请指定 clip");
  }
  const clip = animationPackage.document.clips[0];
  if (!clip) throw new Error("动画包不包含动画");
  return clip;
}

function validateLottieTransforms(clip: SpriteAnimationClip): void {
  for (const [frameIndex, frame] of clip.frames.entries()) {
    for (const element of frame.elements) {
      if (spriteAnimationTransformChannelsAreExact(element.transform)) continue;
      throw new Error(
        `Lottie 无法无损表示 ${element.layerName ?? element.layerId}`
        + ` 第 ${frameIndex} 帧的退化变换矩阵`,
      );
    }
  }
}

function animationBounds(
  animationPackage: SpriteAnimationPackage,
  clip: SpriteAnimationClip,
): SpriteAnimationRectangle {
  if (clip.frames.length === 0) throw new Error(`动画 ${clip.name} 不包含帧`);
  const points = clip.frames.flatMap((frame) => frame.elements.flatMap((element) => {
    const asset = animationPackage.document.assets[element.spriteId];
    if (!asset) throw new Error(`找不到 Sprite ${element.spriteId}`);
    const [a, b, c, d, tx, ty] = element.transform.matrix;
    return [
      [-asset.originX, -asset.originY],
      [asset.width - asset.originX, -asset.originY],
      [-asset.originX, asset.height - asset.originY],
      [asset.width - asset.originX, asset.height - asset.originY],
    ].map(([x = 0, y = 0]) => ({
      x: a * x + c * y + tx,
      y: b * x + d * y + ty,
    }));
  }));
  if (points.length === 0) return sourceAnimationBounds(clip);
  const left = Math.min(...points.map((point) => point.x));
  const right = Math.max(...points.map((point) => point.x));
  const top = Math.min(...points.map((point) => point.y));
  const bottom = Math.max(...points.map((point) => point.y));
  if (![left, right, top, bottom].every(Number.isFinite) || right <= left || bottom <= top) {
    throw new Error(`动画 ${clip.name} 的边界无效`);
  }
  return {
    x: (left + right) / 2,
    y: (top + bottom) / 2,
    width: right - left,
    height: bottom - top,
  };
}

function sourceAnimationBounds(clip: SpriteAnimationClip): SpriteAnimationRectangle {
  const left = Math.min(...clip.frames.map((frame) =>
    frame.bounds.x - frame.bounds.width / 2));
  const right = Math.max(...clip.frames.map((frame) =>
    frame.bounds.x + frame.bounds.width / 2));
  const top = Math.min(...clip.frames.map((frame) =>
    frame.bounds.y - frame.bounds.height / 2));
  const bottom = Math.max(...clip.frames.map((frame) =>
    frame.bounds.y + frame.bounds.height / 2));
  return {
    x: (left + right) / 2,
    y: (top + bottom) / 2,
    width: right - left,
    height: bottom - top,
  };
}

import { createHash } from "node:crypto";
