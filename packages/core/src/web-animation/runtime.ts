import type {
  WebAnimationClip,
  WebAnimationManifest,
} from "./types.js";

export type WebAnimationBounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

const boundsCache = new WeakMap<
  WebAnimationManifest,
  WeakMap<WebAnimationClip, WebAnimationBounds>
>();

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
): WebAnimationBounds {
  const clip = typeof animation === "string" ? selectWebAnimation(manifest, animation) : animation;
  const cached = boundsCache.get(manifest)?.get(clip);
  if (cached) return cached;
  const bounds: WebAnimationBounds = {
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

export function selectWebAnimation(
  manifest: WebAnimationManifest,
  name: string,
): WebAnimationClip {
  const clip = manifest.animations[name];
  if (!clip) throw new Error(`找不到动画 ${name}`);
  return clip;
}
