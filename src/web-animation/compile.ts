import sharp from "sharp";

import type { AnimationBundle } from "../animation/archive.js";
import type { Animation, BuildFrame, BuildSymbol } from "../animation/types.js";
import { rasterizeBuildFrame, type RasterizedBuildFrame } from "./mesh.js";
import type {
  WebAnimationClip,
  WebAnimationManifest,
  WebAnimationPackage,
  WebAnimationSprite,
} from "./types.js";

export type CompileWebAnimationOptions = {
  animations?: readonly string[];
  symbolOverrides?: Readonly<Record<string, string>>;
  atlasFile?: string;
};

type SpriteSource = RasterizedBuildFrame & { key: string };
type SpritePlacement = SpriteSource & { x: number; y: number };

export async function compileWebAnimation(
  bundle: AnimationBundle,
  options: CompileWebAnimationOptions = {},
): Promise<WebAnimationPackage> {
  const animations = selectAnimations(bundle, options.animations);
  const symbolsByHash = new Map(bundle.build.symbols.map((symbol) => [symbol.hash, symbol]));
  const symbolsByName = new Map(bundle.build.symbols.flatMap((symbol) =>
    symbol.name ? [[symbol.name, symbol] as const] : []));
  const resolvedFrames = new Map<string, { symbol: BuildSymbol; frame: BuildFrame }>();

  const clips: Record<string, WebAnimationClip> = {};
  for (const animation of animations) {
    clips[animation.name] = {
      frameRate: animation.frameRate,
      duration: animation.frames.length / animation.frameRate,
      frames: animation.frames.map((frame) => ({
        elements: [...frame.elements]
          .sort((left, right) => left.z - right.z)
          .map((element) => {
            const originalSymbol = symbolsByHash.get(element.symbolHash);
            if (!originalSymbol) throw new Error(`Build 中找不到 symbol 0x${element.symbolHash.toString(16)}`);
            const overrideName = originalSymbol.name
              ? options.symbolOverrides?.[originalSymbol.name]
              : undefined;
            const symbol = overrideName ? symbolsByName.get(overrideName) : originalSymbol;
            if (!symbol) throw new Error(`Build 中找不到 override symbol ${overrideName}`);
            const buildFrame = selectBuildFrame(symbol, element.buildFrame);
            const sprite = `${symbol.hash.toString(16)}:${buildFrame.frameNumber}`;
            resolvedFrames.set(sprite, { symbol, frame: buildFrame });
            const { a, b, c, d, tx, ty } = element.transform;
            return { sprite, transform: [a, b, c, d, tx, ty] as const, z: element.z };
          }),
      })),
    };
  }

  const sourceAtlases = bundle.build.atlases.map((name) => {
    const atlas = bundle.atlases.get(name);
    if (!atlas) throw new Error(`找不到 atlas ${name}`);
    return atlas;
  });
  const spriteSources: SpriteSource[] = [];
  for (const [key, { frame }] of [...resolvedFrames].sort(([left], [right]) => left.localeCompare(right))) {
    spriteSources.push({ key, ...await rasterizeBuildFrame(frame, sourceAtlases) });
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

function selectAnimations(bundle: AnimationBundle, names?: readonly string[]): Animation[] {
  if (!names || names.length === 0) return bundle.animation.animations;
  const selected = names.map((name) => {
    const matches = bundle.animation.animations.filter((animation) => animation.name === name);
    if (matches.length === 0) throw new Error(`找不到动画 ${name}`);
    if (matches.length > 1) throw new Error(`动画名 ${name} 不唯一`);
    const animation = matches[0];
    if (!animation) throw new Error(`找不到动画 ${name}`);
    return animation;
  });
  return [...new Map(selected.map((animation) => [animation.name, animation])).values()];
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
