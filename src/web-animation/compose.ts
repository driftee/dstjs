import sharp from "sharp";
import type { OverlayOptions } from "sharp";

import type {
  WebAnimationClip,
  WebAnimationPackage,
  WebAnimationSprite,
  WebAnimationTransform,
} from "./types.js";

export type WebAnimationLayer = {
  package: WebAnimationPackage;
  animation: string;
  prefix: string;
  offsetX?: number;
  offsetY?: number;
  zOffset?: number;
};

export type ComposeWebAnimationsOptions = {
  animationName?: string;
  atlasFile?: string;
};

export async function composeWebAnimations(
  layers: readonly WebAnimationLayer[],
  options: ComposeWebAnimationsOptions = {},
): Promise<WebAnimationPackage> {
  if (layers.length === 0) throw new Error("至少需要一个 Web 动画图层");
  const prefixes = new Set<string>();
  const resolved = layers.map((layer) => {
    if (!layer.prefix.trim()) throw new Error("Web 动画图层 prefix 不能为空");
    if (prefixes.has(layer.prefix)) throw new Error(`Web 动画图层 prefix 重复：${layer.prefix}`);
    prefixes.add(layer.prefix);
    const clip = layer.package.manifest.animations[layer.animation];
    if (!clip) throw new Error(`图层 ${layer.prefix} 找不到动画 ${layer.animation}`);
    return { ...layer, clip };
  });
  const reference = resolved[0]!.clip;
  for (const layer of resolved.slice(1)) {
    if (
      layer.clip.frameRate !== reference.frameRate
      || layer.clip.frames.length !== reference.frames.length
    ) {
      throw new Error(
        `图层 ${layer.prefix} 的帧率或帧数与首个图层不一致`,
      );
    }
  }

  let atlasOffsetX = 0;
  let atlasHeight = 0;
  const sprites: Record<string, WebAnimationSprite> = {};
  const composites: OverlayOptions[] = [];
  for (const layer of resolved) {
    const { atlas, sprites: layerSprites } = layer.package.manifest;
    const metadata = await sharp(layer.package.atlas).metadata();
    if (metadata.width !== atlas.width || metadata.height !== atlas.height) {
      throw new Error(`图层 ${layer.prefix} 的 atlas 尺寸与 manifest 不一致`);
    }
    composites.push({ input: Buffer.from(layer.package.atlas), left: atlasOffsetX, top: 0 });
    for (const [spriteId, sprite] of Object.entries(layerSprites)) {
      sprites[`${layer.prefix}/${spriteId}`] = {
        ...sprite,
        x: sprite.x + atlasOffsetX,
      };
    }
    atlasOffsetX += atlas.width;
    atlasHeight = Math.max(atlasHeight, atlas.height);
  }
  if (atlasOffsetX > 4096 || atlasHeight > 4096) {
    throw new Error(`合成 atlas 超出 4096x4096：${atlasOffsetX}x${atlasHeight}`);
  }

  const clip: WebAnimationClip = {
    frameRate: reference.frameRate,
    duration: reference.frames.length / reference.frameRate,
    frames: reference.frames.map((_, frameIndex) => ({
      elements: resolved.flatMap((layer) =>
        layer.clip.frames[frameIndex]!.elements.map((element) => ({
          ...element,
          sprite: `${layer.prefix}/${element.sprite}`,
          transform: translateTransform(
            element.transform,
            layer.offsetX ?? 0,
            layer.offsetY ?? 0,
          ),
          z: element.z + (layer.zOffset ?? 0),
        }))),
    })),
  };
  const atlas = await sharp({
    create: {
      width: atlasOffsetX,
      height: atlasHeight,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  }).composite(composites).webp({ lossless: true }).toBuffer();

  return {
    manifest: {
      format: "dstjs-web-animation",
      version: 1,
      atlas: {
        file: options.atlasFile ?? "atlas.webp",
        width: atlasOffsetX,
        height: atlasHeight,
      },
      sprites,
      animations: {
        [options.animationName ?? "idle"]: clip,
      },
    },
    atlas,
  };
}

function translateTransform(
  transform: WebAnimationTransform,
  offsetX: number,
  offsetY: number,
): WebAnimationTransform {
  return [
    transform[0],
    transform[1],
    transform[2],
    transform[3],
    transform[4] + offsetX,
    transform[5] + offsetY,
  ];
}
