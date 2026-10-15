import type {
  WebAnimationManifest,
} from "@driftee/dstjs-core/web-animation";
import {
  webAnimationElementsAtTime,
  webAnimationBounds,
} from "@driftee/dstjs-core/web-animation";

import type {
  DstCanvas2DContext,
  RenderDstAnimationFrameOptions,
} from "./types.js";

export function renderDstAnimationFrame(
  context: DstCanvas2DContext,
  manifest: WebAnimationManifest,
  atlas: CanvasImageSource,
  options: RenderDstAnimationFrameOptions,
): number {
  const { frameIndex, elements } = webAnimationElementsAtTime(
    manifest,
    options.animation,
    options.time,
  );

  const padding = options.padding ?? 0;
  const maxScale = options.maxScale ?? Number.POSITIVE_INFINITY;
  if (!Number.isFinite(padding) || padding < 0) throw new Error(`播放器边距无效：${padding}`);
  if (!(maxScale > 0)) throw new Error(`播放器最大缩放无效：${maxScale}`);

  const bounds = webAnimationBounds(manifest, options.animation);
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
  for (const element of elements) {
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

export {
  animationFrameAtTime,
  webAnimationBounds,
} from "@driftee/dstjs-core/web-animation";
