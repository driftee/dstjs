import type {
  WebAnimationClip,
  WebAnimationElement,
  WebAnimationEntityFollow,
  WebAnimationManifest,
  WebAnimationTransform,
} from "./types.js";

export type WebAnimationBounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export type WebAnimationFrameElements = {
  frameIndex: number;
  elements: WebAnimationElement[];
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

export function webAnimationElementsAtTime(
  manifest: WebAnimationManifest,
  animation: string,
  time: number,
): WebAnimationFrameElements {
  const clip = selectWebAnimation(manifest, animation);
  const isSceneRoot = manifest.scene?.rootAnimation === animation;
  const frameIndex = isSceneRoot
    ? loopingFrameAtTime(clip, time)
    : animationFrameAtTime(clip, time);
  const frame = clip.frames[frameIndex];
  if (!frame) throw new Error(`动画 ${animation} 不包含可渲染帧`);
  if (!manifest.scene || manifest.scene.rootAnimation !== animation) {
    return { frameIndex, elements: [...frame.elements] };
  }

  const elements = [...frame.elements];
  for (const entity of manifest.scene.entities) {
    const anchor = findAnchor(frame.elements, entity.follow);
    if (!anchor) continue;
    const childClip = selectWebAnimation(manifest, entity.animation);
    const childFrame = childClip.frames[loopingFrameAtTime(
      childClip,
      time + (entity.timeOffset ?? 0),
    )];
    if (!childFrame) continue;
    const scale = entity.follow.scale ?? 1;
    const attachment = multiplyTransform(anchor.transform, [
      scale,
      0,
      0,
      scale,
      entity.follow.x ?? 0,
      entity.follow.y ?? 0,
    ]);
    for (const element of childFrame.elements) {
      elements.push({
        ...element,
        transform: multiplyTransform(attachment, element.transform),
        z: anchor.z + (entity.zOffset ?? 0) + element.z * 1e-6,
      });
    }
  }
  return {
    frameIndex,
    elements: elements.sort((left, right) => right.z - left.z),
  };
}

export function webAnimationBounds(
  manifest: WebAnimationManifest,
  animation: string | WebAnimationClip,
): WebAnimationBounds {
  const clip = typeof animation === "string" ? selectWebAnimation(manifest, animation) : animation;
  const animationName = typeof animation === "string"
    ? animation
    : Object.entries(manifest.animations).find(([, candidate]) => candidate === clip)?.[0];
  const cached = boundsCache.get(manifest)?.get(clip);
  if (cached) return cached;
  const bounds = emptyBounds();
  const scene = manifest.scene?.rootAnimation === animationName ? manifest.scene : null;
  const sceneEntities = scene?.entities.map((entity) => ({
    entity,
    clipBounds: clipBounds(manifest, selectWebAnimation(manifest, entity.animation)),
  })) ?? [];
  for (const frame of clip.frames) {
    for (const element of frame.elements) addElementBounds(bounds, manifest, element);
    if (!scene) continue;
    for (const { entity, clipBounds: childBounds } of sceneEntities) {
      const anchor = findAnchor(frame.elements, entity.follow);
      if (!anchor) continue;
      const scale = entity.follow.scale ?? 1;
      const attachment = multiplyTransform(anchor.transform, [
        scale,
        0,
        0,
        scale,
        entity.follow.x ?? 0,
        entity.follow.y ?? 0,
      ]);
      addTransformedBounds(bounds, childBounds, attachment);
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

function loopingFrameAtTime(clip: WebAnimationClip, time: number): number {
  const localTime = ((time % clip.duration) + clip.duration) % clip.duration;
  return Math.min(clip.frames.length - 1, Math.floor(localTime * clip.frameRate));
}

function findAnchor(
  elements: readonly WebAnimationElement[],
  follow: WebAnimationEntityFollow,
): WebAnimationElement | undefined {
  const matches = elements.filter((element) =>
    (follow.layerName === undefined || element.layerName === follow.layerName)
    && (follow.symbolName === undefined || element.symbolName === follow.symbolName)
    && (follow.buildFrame === undefined || element.buildFrame === follow.buildFrame));
  return matches[follow.occurrence ?? 0];
}

function multiplyTransform(
  left: WebAnimationTransform,
  right: WebAnimationTransform,
): WebAnimationTransform {
  const [a,b,c,d,tx,ty] = left;
  const [e,f,g,h,ux,uy] = right;
  return [a*e+c*f, b*e+d*f, a*g+c*h, b*g+d*h, a*ux+c*uy+tx, b*ux+d*uy+ty];
}

function clipBounds(manifest: WebAnimationManifest, clip: WebAnimationClip): WebAnimationBounds {
  const bounds = emptyBounds();
  for (const frame of clip.frames) {
    for (const element of frame.elements) addElementBounds(bounds, manifest, element);
  }
  return Number.isFinite(bounds.left) ? bounds : { left: -1, top: -1, right: 1, bottom: 1 };
}

function addElementBounds(
  bounds: WebAnimationBounds,
  manifest: WebAnimationManifest,
  element: WebAnimationElement,
): void {
  const sprite = manifest.sprites[element.sprite];
  if (!sprite) throw new Error(`动画引用了不存在的 Sprite ${element.sprite}`);
  const local = {
    left: -sprite.originX,
    top: -sprite.originY,
    right: sprite.width - sprite.originX,
    bottom: sprite.height - sprite.originY,
  };
  addTransformedBounds(bounds, local, element.transform);
}

function addTransformedBounds(
  bounds: WebAnimationBounds,
  source: WebAnimationBounds,
  transform: WebAnimationTransform,
): void {
  const [a,b,c,d,tx,ty] = transform;
  const corners: Array<readonly [number, number]> = [
    [source.left, source.top],
    [source.right, source.top],
    [source.left, source.bottom],
    [source.right, source.bottom],
  ];
  for (const [x, y] of corners) {
    const transformedX = a*x+c*y+tx;
    const transformedY = b*x+d*y+ty;
    bounds.left = Math.min(bounds.left, transformedX);
    bounds.top = Math.min(bounds.top, transformedY);
    bounds.right = Math.max(bounds.right, transformedX);
    bounds.bottom = Math.max(bounds.bottom, transformedY);
  }
}

function emptyBounds(): WebAnimationBounds {
  return {
    left: Number.POSITIVE_INFINITY,
    top: Number.POSITIVE_INFINITY,
    right: Number.NEGATIVE_INFINITY,
    bottom: Number.NEGATIVE_INFINITY,
  };
}
