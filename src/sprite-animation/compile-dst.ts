import type { AnimationBundle } from "../animation/archive.js";
import { selectBuildFrame, sortAnimationElementsForDraw } from "../animation/render.js";
import type { Animation, BuildFrame, BuildSymbol } from "../animation/types.js";
import { rasterizeBuildFrame } from "./rasterize.js";
import { createSpriteAnimationTransform } from "./transform.js";
import type {
  SpriteAnimationAsset,
  SpriteAnimationClip,
  SpriteAnimationPackage,
} from "./types.js";

export type CompileDstSpriteAnimationOptions = {
  animations?: readonly string[];
  bank?: string;
  facing?: number;
  symbolOverrides?: Readonly<Record<string, string>>;
  skipMissingSymbols?: boolean;
};

export async function compileDstSpriteAnimation(
  bundle: AnimationBundle,
  options: CompileDstSpriteAnimationOptions = {},
): Promise<SpriteAnimationPackage> {
  const animations = selectAnimations(bundle, options);
  const symbolsByHash = new Map(bundle.build.symbols.map((symbol) => [symbol.hash, symbol]));
  const symbolsByName = new Map(bundle.build.symbols.flatMap((symbol) =>
    symbol.name ? [[symbol.name, symbol] as const] : []));
  const resolvedFrames = new Map<string, { symbol: BuildSymbol; frame: BuildFrame }>();

  const clips: SpriteAnimationClip[] = animations.map((animation) => ({
    id: animationId(animation),
    name: animation.name,
    frameRate: animation.frameRate,
    durationFrames: animation.frames.length,
    frames: animation.frames.map((frame) => ({
      bounds: { ...frame.bounds },
      events: frame.events.map((event) => ({
        name: event.name,
        metadata: { dstHash: event.hash },
      })),
      elements: sortAnimationElementsForDraw(frame.elements).flatMap((element) => {
        const originalSymbol = symbolsByHash.get(element.symbolHash);
        if (!originalSymbol) {
          if (options.skipMissingSymbols) return [];
          throw new Error(`Build 中找不到 symbol 0x${element.symbolHash.toString(16)}`);
        }
        const overrideName = originalSymbol.name
          ? options.symbolOverrides?.[originalSymbol.name]
          : undefined;
        const symbol = overrideName ? symbolsByName.get(overrideName) : originalSymbol;
        if (!symbol) {
          if (options.skipMissingSymbols) return [];
          throw new Error(`Build 中找不到 override symbol ${overrideName}`);
        }
        const buildFrame = selectBuildFrame(symbol, element.buildFrame, options.skipMissingSymbols);
        if (!buildFrame) return [];
        const spriteId = `${symbol.hash.toString(16)}:${buildFrame.frameNumber}`;
        resolvedFrames.set(spriteId, { symbol, frame: buildFrame });
        const { a, b, c, d, tx, ty } = element.transform;
        return [{
          spriteId,
          layerId: `dst:${element.layerHash.toString(16)}`,
          layerName: element.layerName,
          transform: createSpriteAnimationTransform([a, b, c, d, tx, ty]),
          z: element.z,
          metadata: {
            dstSymbolHash: element.symbolHash,
            dstSymbolName: element.symbolName,
            dstBuildFrame: element.buildFrame,
            dstLayerHash: element.layerHash,
          },
        }];
      }),
    })),
    metadata: {
      dstBankHash: animation.bankHash,
      dstBankName: animation.bankName,
      dstFacing: animation.facing,
    },
  }));

  const sourceAtlases = bundle.build.atlases.map((name) => {
    const atlas = bundle.atlases.get(name);
    if (!atlas) throw new Error(`找不到 atlas ${name}`);
    return atlas;
  });
  const assets: Record<string, SpriteAnimationAsset> = {};
  const images = new Map<string, Buffer>();
  for (const [id, { symbol, frame }] of [...resolvedFrames].sort(([left], [right]) => left.localeCompare(right))) {
    const sprite = await rasterizeBuildFrame(frame, sourceAtlases);
    assets[id] = {
      id,
      name: symbol.name,
      width: sprite.width,
      height: sprite.height,
      originX: sprite.originX,
      originY: sprite.originY,
      mimeType: "image/png",
      metadata: {
        dstSymbolHash: symbol.hash,
        dstBuildFrame: frame.frameNumber,
        dstBuildFrameDuration: frame.duration,
      },
    };
    images.set(id, sprite.png);
  }

  return {
    document: {
      format: "dstjs-sprite-animation",
      version: 1,
      coordinateSystem: {
        xAxis: "right",
        yAxis: "down",
        transform: "affine-2d",
      },
      assets,
      clips,
      metadata: {
        sourceFormat: "dst",
        dstAnimationVersion: bundle.animation.version,
        dstBuildVersion: bundle.build.version,
        dstBuildName: bundle.build.name,
      },
    },
    images,
  };
}

function animationId(animation: Animation): string {
  return `dst:${animation.bankHash.toString(16)}:${animation.name}:${animation.facing}`;
}

function selectAnimations(
  bundle: AnimationBundle,
  options: Pick<CompileDstSpriteAnimationOptions, "animations" | "bank" | "facing">,
): Animation[] {
  const { animations: names, bank, facing } = options;
  const matchesSelector = (animation: Animation): boolean =>
    (bank === undefined || animation.bankName === bank)
    && (facing === undefined || animation.facing === facing);
  if (!names || names.length === 0) return bundle.animation.animations.filter(matchesSelector);
  const selected = names.map((name) => {
    const matches = bundle.animation.animations.filter((animation) =>
      animation.name === name && matchesSelector(animation));
    if (matches.length === 0) throw new Error(`找不到动画 ${name}`);
    if (matches.length > 1) throw new Error(`动画名 ${name} 不唯一`);
    const animation = matches[0];
    if (!animation) throw new Error(`找不到动画 ${name}`);
    return animation;
  });
  return [...new Map(selected.map((animation) => [animationId(animation), animation])).values()];
}
