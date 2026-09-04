import sharp from "sharp";

import type { AnimationBundle } from "../animation/archive.js";
import {
  compileDstSpriteAnimation,
  type SpriteAnimationPackage,
} from "../sprite-animation/index.js";
import type {
  WebAnimationClip,
  WebAnimationManifest,
  WebAnimationPackage,
  WebAnimationSprite,
} from "./types.js";

export type CompileWebAnimationOptions = {
  animations?: readonly string[];
  bank?: string;
  facing?: number;
  symbolOverrides?: Readonly<Record<string, string>>;
  atlasFile?: string;
};

type SpriteSource = {
  key: string;
  png: Buffer;
  width: number;
  height: number;
  originX: number;
  originY: number;
};
type SpritePlacement = SpriteSource & { x: number; y: number };

export async function compileWebAnimation(
  bundle: AnimationBundle,
  options: CompileWebAnimationOptions = {},
): Promise<WebAnimationPackage> {
  const animationPackage = await compileDstSpriteAnimation(bundle, options);
  return compileWebAnimationPackage(animationPackage, options);
}

export async function compileWebAnimationPackage(
  animationPackage: SpriteAnimationPackage,
  options: Pick<CompileWebAnimationOptions, "atlasFile"> = {},
): Promise<WebAnimationPackage> {
  const clips: Record<string, WebAnimationClip> = {};
  for (const clip of animationPackage.document.clips) {
    if (clips[clip.name]) throw new Error(`动画名 ${clip.name} 不唯一，无法编译为 Web 动画`);
    clips[clip.name] = {
      frameRate: clip.frameRate,
      duration: clip.durationFrames / clip.frameRate,
      frames: clip.frames.map((frame) => ({
        elements: frame.elements.map((element) => ({
          sprite: element.spriteId,
          transform: element.transform.matrix,
          z: element.z,
        })),
      })),
    };
  }

  const spriteSources: SpriteSource[] = [];
  for (const [key, asset] of Object.entries(animationPackage.document.assets)
    .sort(([left], [right]) => left.localeCompare(right))) {
    const png = animationPackage.images.get(key);
    if (!png) throw new Error(`Sprite ${key} 缺少图片数据`);
    spriteSources.push({
      key,
      png,
      width: asset.width,
      height: asset.height,
      originX: asset.originX,
      originY: asset.originY,
    });
  }
  const { placements, width, height } = packSprites(spriteSources);
  const atlas = await sharp({
    create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite(placements.map((sprite) => ({ input: sprite.png, left: sprite.x, top: sprite.y })))
    .webp({ lossless: true })
    .toBuffer();
  const sprites = Object.fromEntries(placements.map((sprite): [string, WebAnimationSprite] => [sprite.key, {
    x: sprite.x,
    y: sprite.y,
    width: sprite.width,
    height: sprite.height,
    originX: sprite.originX,
    originY: sprite.originY,
  }]));
  const manifest: WebAnimationManifest = {
    format: "dstjs-web-animation",
    version: 1,
    atlas: { file: options.atlasFile ?? "atlas.webp", width, height },
    sprites,
    animations: clips,
  };
  return { manifest, atlas };
}

function packSprites(sources: SpriteSource[], padding = 2): {
  placements: SpritePlacement[];
  width: number;
  height: number;
} {
  if (sources.length === 0) throw new Error("Web 动画不包含 sprite");
  const totalArea = sources.reduce((sum, sprite) => sum + (sprite.width + padding) * (sprite.height + padding), 0);
  const widest = Math.max(...sources.map((sprite) => sprite.width + padding * 2));
  const width = Math.min(4096, nextPowerOfTwo(Math.max(widest, Math.ceil(Math.sqrt(totalArea)))));
  const placements: SpritePlacement[] = [];
  let x = padding;
  let y = padding;
  let rowHeight = 0;
  for (const source of [...sources].sort((left, right) => right.height - left.height || left.key.localeCompare(right.key))) {
    if (x + source.width + padding > width) {
      x = padding;
      y += rowHeight + padding;
      rowHeight = 0;
    }
    placements.push({ ...source, x, y });
    x += source.width + padding;
    rowHeight = Math.max(rowHeight, source.height);
  }
  const height = nextPowerOfTwo(y + rowHeight + padding);
  if (height > 4096) throw new Error(`Web 动画 atlas 高度 ${height} 超过 4096 像素限制`);
  return { placements, width, height };
}

function nextPowerOfTwo(value: number): number {
  return 2 ** Math.ceil(Math.log2(Math.max(1, value)));
}
