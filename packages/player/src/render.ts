import type {
  WebAnimationClip,
  WebAnimationManifest,
} from "@driftee/dstjs-core/web-animation";

import type {
  DstAnimationBounds,
  DstCanvas2DContext,
  RenderDstAnimationFrameOptions,
} from "./types.js";

const boundsCache = new WeakMap<
  WebAnimationManifest,
  WeakMap<WebAnimationClip, DstAnimationBounds>
>();

export function renderDstAnimationFrame(
  context: DstCanvas2DContext,
  manifest: WebAnimationManifest,
  atlas: CanvasImageSource,
  options: RenderDstAnimationFrameOptions,
): number {
  const clip = selectAnimation(manifest, options.animation);
  const frameIndex = animationFrameAtTime(clip, options.time);
  const frame = clip.frames[frameIndex];
  if (!frame) throw new Error(`动画 ${options.animation} 不包含可渲染帧`);

  const padding = options.padding ?? 0;
  const maxScale = options.maxScale ?? Number.POSITIVE_INFINITY;
  if (!Number.isFinite(padding) || padding < 0) throw new Error(`播放器边距无效：${padding}`);
  if (!(maxScale > 0)) throw new Error(`播放器最大缩放无效：${maxScale}`);

  const bounds = webAnimationBounds(manifest, clip);
  const width = context.canvas.width;
  const height = context.canvas.height;
  const availableWidth = Math.max(1, width - padding * 2);
  const availableHeight = Math.max(1, height - padding * 2);
  const boundsWidth = Math.max(1e-8, bounds.right - bounds.left);
  const boundsHeight = Math.max(1e-8, bounds.bottom - bounds.top);
  const fit = options.fit ?? "contain";
  const fitScale = fit === "none"
    ? 1
    : fit === "cover"
      ? Math.max(availableWidth / boundsWidth, availableHeight / boundsHeight)
      : Math.min(availableWidth / boundsWidth, availableHeight / boundsHeight);
  const scale = Math.min(fitScale, maxScale);
  const centerX = (bounds.left + bounds.right) / 2;
  const centerY = (bounds.top + bounds.bottom) / 2;

  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  if (options.clear ?? true) context.clearRect(0, 0, width, height);
  context.setTransform(
    scale,
    0,
    0,
    scale,
    width / 2 - centerX * scale,
    height / 2 - centerY * scale,
  );
  for (const element of frame.elements) {
    const sprite = manifest.sprites[element.sprite];
    if (!sprite) throw new Error(`动画 ${options.animation} 引用了不存在的 Sprite ${element.sprite}`);
    const [a, b, c, d, tx, ty] = element.transform;
    context.save();
    context.transform(a, b, c, d, tx, ty);
    context.drawImage(
      atlas,
      sprite.x,
      sprite.y,
      sprite.width,
      sprite.height,
      -sprite.originX,
      -sprite.originY,
      sprite.width,
      sprite.height,
    );
    context.restore();
  }
  context.restore();
  return frameIndex;
}

export function animationFrameAtTime(clip: WebAnimationClip, time: number): number {
  if (!Number.isFinite(time)) throw new Error(`动画时间无效：${time}`);
  return Math.min(
    clip.frames.length - 1,
    Math.max(0, Math.floor(Math.max(0, time) * clip.frameRate)),
  );
}

export function webAnimationBounds(
  manifest: WebAnimationManifest,
  animation: string | WebAnimationClip,
): DstAnimationBounds {
  const clip = typeof animation === "string" ? selectAnimation(manifest, animation) : animation;
  const cached = boundsCache.get(manifest)?.get(clip);
  if (cached) return cached;
  const bounds: DstAnimationBounds = {
    left: Number.POSITIVE_INFINITY,
    top: Number.POSITIVE_INFINITY,
    right: Number.NEGATIVE_INFINITY,
    bottom: Number.NEGATIVE_INFINITY,
  };
  for (const frame of clip.frames) {
    for (const element of frame.elements) {
      const sprite = manifest.sprites[element.sprite];
      if (!sprite) throw new Error(`动画引用了不存在的 Sprite ${element.sprite}`);
      const [a, b, c, d, tx, ty] = element.transform;
      const corners = [
        [-sprite.originX, -sprite.originY],
        [sprite.width - sprite.originX, -sprite.originY],
        [-sprite.originX, sprite.height - sprite.originY],
        [sprite.width - sprite.originX, sprite.height - sprite.originY],
      ];
      for (const [x = 0, y = 0] of corners) {
        const transformedX = a * x + c * y + tx;
        const transformedY = b * x + d * y + ty;
        bounds.left = Math.min(bounds.left, transformedX);
        bounds.top = Math.min(bounds.top, transformedY);
        bounds.right = Math.max(bounds.right, transformedX);
        bounds.bottom = Math.max(bounds.bottom, transformedY);
      }
    }
  }
  const resolved = Number.isFinite(bounds.left)
    ? bounds
    : { left: -1, top: -1, right: 1, bottom: 1 };
  let manifestBounds = boundsCache.get(manifest);
  if (!manifestBounds) {
    manifestBounds = new WeakMap();
    boundsCache.set(manifest, manifestBounds);
  }
  manifestBounds.set(clip, resolved);
  return resolved;
}

function selectAnimation(manifest: WebAnimationManifest, name: string): WebAnimationClip {
  const clip = manifest.animations[name];
  if (!clip) throw new Error(`找不到动画 ${name}`);
  return clip;
}
