import sharp from "sharp";
import type { OverlayOptions } from "sharp";

import type {
  WebAnimationElement,
  WebAnimationManifest,
  WebAnimationClip,
  WebAnimationPackage,
  WebAnimationSprite,
  WebAnimationTransform,
} from "./types.js";

export type AnimationEntityFollow = {
  layerName?: string;
  symbolName?: string;
  buildFrame?: number;
  occurrence?: number;
  x?: number;
  y?: number;
  scale?: number;
};

export type AnimationEntitySource = {
  id: string;
  anim: string;
  build?: string;
  animation: string;
  bank?: string;
  facing?: number;
  follow: AnimationEntityFollow;
  zOffset?: number;
  timeOffset?: number;
  hiddenLayers?: string[];
  hiddenSymbols?: string[];
  skipMissingSymbols?: boolean;
};

export type AnimationEntitySceneConfig = {
  version: 1;
  entities: AnimationEntitySource[];
};

export type CompiledAnimationEntity = Omit<AnimationEntitySource, "anim" | "build" | "bank" | "facing" | "hiddenLayers" | "hiddenSymbols" | "skipMissingSymbols"> & {
  package: WebAnimationPackage;
};

export type AnimationEntityPlayerOptions = {
  title?: string;
  initialAnimation?: string;
  entities?: readonly CompiledAnimationEntity[];
};

export type AnimationEntitySceneManifest = {
  format: "dstjs-web-animation-scene";
  version: 1;
  root: { manifest: string; animation: string };
  entities: Array<{
    id: string;
    manifest: string;
    animation: string;
    follow: AnimationEntityFollow;
    zOffset: number;
    timeOffset: number;
  }>;
};

export async function compileAnimationEntityScenePackage(
  rootPackage: WebAnimationPackage,
  rootAnimation: string,
  entities: readonly CompiledAnimationEntity[],
): Promise<WebAnimationPackage> {
  const rootClip = rootPackage.manifest.animations[rootAnimation];
  if (!rootClip) {
    throw new Error(`主体找不到动画 ${rootAnimation}`);
  }
  for (const entity of entities) {
    if (!rootClip.frames.some((frame) => findAnchor(frame.elements, entity.follow))) {
      throw new Error(`实体 ${entity.id} 找不到主体挂点`);
    }
  }
  const packages = [
    { prefix: "root", package: rootPackage },
    ...entities.map((entity) => ({ prefix: `entity/${entity.id}`, package: entity.package })),
  ];
  const placements = packAtlases(packages.map(({ package: item }) => ({
    width: item.manifest.atlas.width,
    height: item.manifest.atlas.height,
  })));
  const sprites: Record<string, WebAnimationSprite> = {};
  const animations: Record<string, WebAnimationClip> = {};
  const composites: OverlayOptions[] = [];

  for (const [index, item] of packages.entries()) {
    const placement = placements.items[index];
    if (!placement) throw new Error("场景图集布局缺失");
    const metadata = await sharp(item.package.atlas).metadata();
    if (
      metadata.width !== item.package.manifest.atlas.width
      || metadata.height !== item.package.manifest.atlas.height
    ) {
      throw new Error(`场景实体 ${item.prefix} 的图集尺寸与清单不一致`);
    }
    composites.push({
      input: Buffer.from(item.package.atlas),
      left: placement.x,
      top: placement.y,
    });
    for (const [spriteId, sprite] of Object.entries(item.package.manifest.sprites)) {
      sprites[`${item.prefix}/${spriteId}`] = {
        ...sprite,
        x: sprite.x + placement.x,
        y: sprite.y + placement.y,
      };
    }
    for (const [animationName, clip] of Object.entries(item.package.manifest.animations)) {
      const targetName = item.prefix === "root"
        ? animationName
        : `${item.prefix}/${animationName}`;
      animations[targetName] = {
        ...clip,
        frames: clip.frames.map((frame) => ({
          elements: frame.elements.map((element) => ({
            ...element,
            sprite: `${item.prefix}/${element.sprite}`,
          })),
        })),
      };
    }
  }

  const atlas = await sharp({
    create: {
      width: placements.width,
      height: placements.height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  }).composite(composites).webp({ lossless: true }).toBuffer();

  return {
    manifest: {
      format: "dstjs-web-animation",
      version: 1,
      atlas: { file: "atlas.webp", width: placements.width, height: placements.height },
      sprites,
      animations,
      scene: {
        rootAnimation,
        entities: entities.map((entity) => ({
          id: entity.id,
          animation: `entity/${entity.id}/${entity.animation}`,
          follow: entity.follow,
          ...(entity.zOffset === undefined ? {} : { zOffset: entity.zOffset }),
          ...(entity.timeOffset === undefined ? {} : { timeOffset: entity.timeOffset }),
        })),
      },
    },
    atlas,
  };
}

function packAtlases(items: readonly { width: number; height: number }[]): {
  width: number;
  height: number;
  items: Array<{ x: number; y: number }>;
} {
  const totalArea = items.reduce((sum, item) => sum + item.width * item.height, 0);
  const widest = Math.max(...items.map(({ width }) => width));
  const width = Math.min(4096, nextPowerOfTwo(Math.max(widest, Math.ceil(Math.sqrt(totalArea)))));
  const placements: Array<{ x: number; y: number }> = [];
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  for (const item of items) {
    if (x > 0 && x + item.width > width) {
      x = 0;
      y += rowHeight;
      rowHeight = 0;
    }
    placements.push({ x, y });
    x += item.width;
    rowHeight = Math.max(rowHeight, item.height);
  }
  const height = nextPowerOfTwo(y + rowHeight);
  if (height > 4096) throw new Error(`场景图集超出 4096x4096：${width}x${height}`);
  return { width, height, items: placements };
}

function nextPowerOfTwo(value: number): number {
  return 2 ** Math.ceil(Math.log2(Math.max(1, value)));
}


type Bounds = { left: number; top: number; right: number; bottom: number };

export function parseAnimationEntitySceneConfig(value: unknown): AnimationEntitySceneConfig {
  const root = record(value, "场景配置");
  if (root.version !== 1) throw new Error("场景配置 version 必须为 1");
  if (!Array.isArray(root.entities) || root.entities.length === 0) {
    throw new Error("场景配置必须包含至少一个 entities 项");
  }
  const ids = new Set<string>();
  const entities = root.entities.map((item, index): AnimationEntitySource => {
    const entity = record(item, `entities[${index}]`);
    const id = string(entity.id, `entities[${index}].id`);
    if (!/^[a-z0-9][a-z0-9_-]*$/i.test(id)) throw new Error(`实体 ID 无效：${id}`);
    if (ids.has(id)) throw new Error(`实体 ID 重复：${id}`);
    ids.add(id);
    const followValue = record(entity.follow, `entities[${index}].follow`);
    const layerName = optionalString(followValue.layerName, `entities[${index}].follow.layerName`);
    const symbolName = optionalString(followValue.symbolName, `entities[${index}].follow.symbolName`);
    if (!layerName && !symbolName) throw new Error(`实体 ${id} 的 follow 需要 layerName 或 symbolName`);
    const follow: AnimationEntityFollow = {
      ...(layerName ? { layerName } : {}),
      ...(symbolName ? { symbolName } : {}),
      ...optionalNonNegativeInteger(followValue.buildFrame, `${id}.follow.buildFrame`),
      ...optionalNonNegativeInteger(followValue.occurrence, `${id}.follow.occurrence`),
      ...optionalFinite(followValue.x, `${id}.follow.x`),
      ...optionalFinite(followValue.y, `${id}.follow.y`),
      ...optionalPositive(followValue.scale, `${id}.follow.scale`),
    };
    return {
      id,
      anim: string(entity.anim, `${id}.anim`),
      ...optionalStringField(entity.build, "build", `${id}.build`),
      animation: string(entity.animation, `${id}.animation`),
      ...optionalStringField(entity.bank, "bank", `${id}.bank`),
      ...optionalNonNegativeInteger(entity.facing, `${id}.facing`),
      follow,
      ...optionalFinite(entity.zOffset, `${id}.zOffset`),
      ...optionalFinite(entity.timeOffset, `${id}.timeOffset`),
      ...optionalStringArray(entity.hiddenLayers, "hiddenLayers", `${id}.hiddenLayers`),
      ...optionalStringArray(entity.hiddenSymbols, "hiddenSymbols", `${id}.hiddenSymbols`),
      ...(entity.skipMissingSymbols === undefined
        ? {}
        : { skipMissingSymbols: boolean(entity.skipMissingSymbols, `${id}.skipMissingSymbols`) }),
    };
  });
  return { version: 1, entities };
}

export function createAnimationEntityPlayerHtml(
  rootPackage: WebAnimationPackage,
  options: AnimationEntityPlayerOptions = {},
): string {
  const animationNames = Object.keys(rootPackage.manifest.animations);
  const initialAnimation = options.initialAnimation ?? animationNames[0];
  if (!initialAnimation || !rootPackage.manifest.animations[initialAnimation]) {
    throw new Error(`找不到初始动画 ${initialAnimation ?? ""}`);
  }
  const entities = [...(options.entities ?? [])];
  for (const entity of entities) {
    if (!entity.package.manifest.animations[entity.animation]) {
      throw new Error(`实体 ${entity.id} 找不到动画 ${entity.animation}`);
    }
  }
  const title = escapeHtml(options.title ?? "DST.js 多实体动画播放器");
  const packageJson = JSON.stringify({
    root: embeddedPackage(rootPackage),
    entities: entities.map((entity) => ({
      id: entity.id,
      animation: entity.animation,
      follow: entity.follow,
      zOffset: entity.zOffset ?? 0,
      timeOffset: entity.timeOffset ?? 0,
      atlas: dataUrl(entity.package.atlas),
      package: { manifest: entity.package.manifest },
    })),
    bounds: Object.fromEntries(animationNames.map((name) => [
      name,
      sceneBounds(rootPackage.manifest, name, entities),
    ])),
  }).replaceAll("<", "\\u003c");
  const animationOptions = animationNames.map((name) =>
    `<option value="${escapeHtml(name)}"${name === initialAnimation ? " selected" : ""}>${escapeHtml(name)}</option>`).join("");

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title}</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
    * { box-sizing: border-box; }
    html, body { width: 100%; min-height: 100%; margin: 0; }
    body { overflow: hidden; background: #151817; color: #f3f4ef; }
    main { position: fixed; inset: 0; background: #202421; }
    canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
    header { position: fixed; z-index: 2; top: 20px; left: 24px; pointer-events: none; }
    h1 { margin: 0; font-size: 22px; font-weight: 600; letter-spacing: 0; }
    #status { margin: 6px 0 0; color: rgba(243,244,239,.64); font-size: 12px; }
    .controls { position: fixed; z-index: 2; right: 16px; bottom: 16px; left: 16px; display: flex; max-width: 700px; align-items: end; gap: 12px; margin: auto; padding: 12px; border: 1px solid rgba(255,255,255,.1); border-radius: 8px; background: rgba(26,30,28,.9); }
    label { display: grid; min-width: 120px; flex: 1; gap: 6px; color: rgba(243,244,239,.68); font-size: 11px; }
    label span { display: flex; justify-content: space-between; gap: 12px; }
    select, button { min-height: 38px; border: 1px solid rgba(255,255,255,.14); border-radius: 6px; font: inherit; }
    select { padding: 0 9px; background: #272c29; color: #f3f4ef; }
    input[type="range"] { width: 100%; min-height: 38px; accent-color: #b8c8ba; }
    button { padding: 0 15px; background: #e7ebe5; color: #202421; cursor: pointer; font-weight: 700; }
    button.secondary { background: #303632; color: #f3f4ef; }
@media (max-width: 600px) {
      header { top: 14px; left: 14px; }
      h1 { max-width: calc(100vw - 28px); font-size: 18px; }
      .controls { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 8px; padding: 10px; }
      label { min-width: 0; }
      select, button { width: 100%; min-width: 0; }
    }
  </style>
</head>
<body>
  <main><canvas id="player" aria-label="DST 多实体动画画布"></canvas></main>
  <header><h1>${title}</h1><p id="status">正在加载贴图...</p></header>
  <form class="controls" onsubmit="return false">
    <label><span>动作</span><select id="animation">${animationOptions}</select></label>
    <label><span>速度 <strong id="speed-value">1.0x</strong></span><input id="speed" type="range" min="0.2" max="2" value="1" step="0.1"></label>
    <button id="replay" class="secondary" type="button">重播</button>
    <button id="toggle" type="button">暂停</button>
  </form>
  <script id="animation-scene" type="application/json">${packageJson}</script>
  <script>
    (() => {
      "use strict";
      const data = JSON.parse(document.getElementById("animation-scene").textContent);
      const canvas = document.getElementById("player");
      const context = canvas.getContext("2d");
      const animationInput = document.getElementById("animation");
      const speedInput = document.getElementById("speed");
      const speedValue = document.getElementById("speed-value");
      const replayButton = document.getElementById("replay");
      const toggleButton = document.getElementById("toggle");
      const status = document.getElementById("status");
      const sources = [data.root, ...data.entities.map(entity => ({ manifest: entity.package.manifest, atlas: entity.atlas }))];
      const images = sources.map(source => Object.assign(new Image(), { src: source.atlas }));
      let animationName = animationInput.value;
      let elapsed = 0;
      let playing = !matchMedia("(prefers-reduced-motion: reduce)").matches;
      let previousTime = 0;
      let request = 0;
      let width = innerWidth;
      let height = innerHeight;
      let dpr = 1;

      function frameAt(clip, time) {
        const local = ((time % clip.duration) + clip.duration) % clip.duration;
        return clip.frames[Math.min(clip.frames.length - 1, Math.floor(local * clip.frameRate))];
      }
      function multiply(left, right) {
        const [a,b,c,d,tx,ty] = left;
        const [e,f,g,h,ux,uy] = right;
        return [a*e+c*f, b*e+d*f, a*g+c*h, b*g+d*h, a*ux+c*uy+tx, b*ux+d*uy+ty];
      }
      function anchorFor(frame, follow) {
        const matches = frame.elements.filter(element =>
          (follow.layerName === undefined || element.layerName === follow.layerName)
          && (follow.symbolName === undefined || element.symbolName === follow.symbolName)
          && (follow.buildFrame === undefined || element.buildFrame === follow.buildFrame));
        return matches[follow.occurrence || 0];
      }
      function itemsAt(time) {
        const rootManifest = data.root.manifest;
        const rootClip = rootManifest.animations[animationName];
        const rootFrame = frameAt(rootClip, time);
        const items = rootFrame.elements.map(element => ({ element, manifest: rootManifest, image: images[0], z: element.z }));
        data.entities.forEach((entity, index) => {
          const anchor = anchorFor(rootFrame, entity.follow);
          if (!anchor) return;
          const manifest = entity.package.manifest;
          const clip = manifest.animations[entity.animation];
          const frame = frameAt(clip, time + (entity.timeOffset || 0));
          const scale = entity.follow.scale || 1;
          const attachment = multiply(anchor.transform, [scale,0,0,scale,entity.follow.x || 0,entity.follow.y || 0]);
          frame.elements.forEach(element => items.push({
            element: { ...element, transform: multiply(attachment, element.transform) },
            manifest,
            image: images[index + 1],
            z: anchor.z + (entity.zOffset || 0) + element.z * 1e-6,
          }));
        });
        return items.sort((left, right) => right.z - left.z);
      }
      function draw() {
        context.setTransform(1,0,0,1,0,0);
        context.clearRect(0,0,canvas.width,canvas.height);
        const bounds = data.bounds[animationName];
        const boundsWidth = Math.max(1, bounds.right - bounds.left);
        const boundsHeight = Math.max(1, bounds.bottom - bounds.top);
        const availableHeight = Math.max(160, height - 128);
        const scale = Math.min(width * .82 / boundsWidth, availableHeight * .88 / boundsHeight, 3.2);
        const centerX = (bounds.left + bounds.right) / 2;
        const centerY = (bounds.top + bounds.bottom) / 2;
        context.setTransform(dpr*scale,0,0,dpr*scale,dpr*(width/2-centerX*scale),dpr*(availableHeight/2+20-centerY*scale));
        for (const item of itemsAt(elapsed)) {
          const sprite = item.manifest.sprites[item.element.sprite];
          if (!sprite) continue;
          const [a,b,c,d,tx,ty] = item.element.transform;
          context.save();
          context.transform(a,b,c,d,tx,ty);
          context.drawImage(item.image,sprite.x,sprite.y,sprite.width,sprite.height,-sprite.originX,-sprite.originY,sprite.width,sprite.height);
          context.restore();
        }
        const rootClip = data.root.manifest.animations[animationName];
        const rootFrame = Math.floor((elapsed % rootClip.duration) * rootClip.frameRate) + 1;
        status.textContent = animationName + " · " + rootFrame + "/" + rootClip.frames.length + " 帧 · " + data.entities.length + " 个 follower";
      }
      function resize() {
        width = innerWidth; height = innerHeight; dpr = Math.min(devicePixelRatio || 1, 2);
        canvas.width = Math.round(width*dpr); canvas.height = Math.round(height*dpr);
        draw();
      }
      function tick(time) {
        if (!playing) return;
        const delta = previousTime === 0 ? 0 : Math.min(.05, (time-previousTime)/1000);
        previousTime = time;
        elapsed += delta * Number(speedInput.value);
        draw();
        request = requestAnimationFrame(tick);
      }
      function start() {
        cancelAnimationFrame(request); previousTime = 0;
        toggleButton.textContent = playing ? "暂停" : "播放";
        speedValue.textContent = Number(speedInput.value).toFixed(1) + "x";
        if (playing && images.every(image => image.complete)) request = requestAnimationFrame(tick);
      }
      animationInput.addEventListener("change", () => { animationName = animationInput.value; elapsed = 0; draw(); });
      speedInput.addEventListener("input", start);
      replayButton.addEventListener("click", () => { elapsed = 0; playing = true; draw(); start(); });
      toggleButton.addEventListener("click", () => { playing = !playing; start(); });
      addEventListener("resize", resize);
      Promise.all(images.map(image => new Promise((resolve, reject) => {
        if (image.complete) resolve(); else { image.onload = resolve; image.onerror = reject; }
      }))).then(() => { resize(); start(); }).catch(() => { status.textContent = "贴图加载失败"; });
    })();
  </script>
</body>
</html>`;
}

function sceneBounds(
  rootManifest: WebAnimationManifest,
  animation: string,
  entities: readonly CompiledAnimationEntity[],
): Bounds {
  const bounds: Bounds = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
  const rootClip = rootManifest.animations[animation];
  if (!rootClip) throw new Error(`找不到动画 ${animation}`);
  for (const rootFrame of rootClip.frames) {
    for (const element of rootFrame.elements) addElementBounds(bounds, rootManifest, element);
    for (const entity of entities) {
      const anchor = findAnchor(rootFrame.elements, entity.follow);
      if (!anchor) continue;
      const clip = entity.package.manifest.animations[entity.animation];
      if (!clip) continue;
      const scale = entity.follow.scale ?? 1;
      const attachment = multiplyTransform(anchor.transform, [
        scale, 0, 0, scale, entity.follow.x ?? 0, entity.follow.y ?? 0,
      ]);
      for (const childFrame of clip.frames) {
        for (const element of childFrame.elements) {
          addElementBounds(bounds, entity.package.manifest, {
            ...element,
            transform: multiplyTransform(attachment, element.transform),
          });
        }
      }
    }
  }
  return Number.isFinite(bounds.left) ? bounds : { left: -1, top: -1, right: 1, bottom: 1 };
}

function findAnchor(
  elements: readonly WebAnimationElement[],
  follow: AnimationEntityFollow,
): WebAnimationElement | undefined {
  const matches = elements.filter((element) =>
    (follow.layerName === undefined || element.layerName === follow.layerName)
    && (follow.symbolName === undefined || element.symbolName === follow.symbolName)
    && (follow.buildFrame === undefined || element.buildFrame === follow.buildFrame));
  return matches[follow.occurrence ?? 0];
}

function addElementBounds(bounds: Bounds, manifest: WebAnimationManifest, element: WebAnimationElement): void {
  const sprite = manifest.sprites[element.sprite];
  if (!sprite) return;
  const [a,b,c,d,tx,ty] = element.transform;
  const corners = [
    [-sprite.originX, -sprite.originY],
    [sprite.width-sprite.originX, -sprite.originY],
    [-sprite.originX, sprite.height-sprite.originY],
    [sprite.width-sprite.originX, sprite.height-sprite.originY],
  ];
  for (const [x = 0, y = 0] of corners) {
    const px = a*x+c*y+tx;
    const py = b*x+d*y+ty;
    bounds.left = Math.min(bounds.left, px); bounds.right = Math.max(bounds.right, px);
    bounds.top = Math.min(bounds.top, py); bounds.bottom = Math.max(bounds.bottom, py);
  }
}

function multiplyTransform(left: WebAnimationTransform, right: WebAnimationTransform): WebAnimationTransform {
  const [a,b,c,d,tx,ty] = left;
  const [e,f,g,h,ux,uy] = right;
  return [a*e+c*f, b*e+d*f, a*g+c*h, b*g+d*h, a*ux+c*uy+tx, b*ux+d*uy+ty];
}

function embeddedPackage(package_: WebAnimationPackage): { manifest: WebAnimationManifest; atlas: string } {
  return { manifest: package_.manifest, atlas: dataUrl(package_.atlas) };
}

function dataUrl(bytes: Uint8Array): string {
  return `data:image/webp;base64,${Buffer.from(bytes).toString("base64")}`;
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${name} 必须是对象`);
  return value as Record<string, unknown>;
}
function string(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${name} 必须是非空字符串`);
  return value;
}
function boolean(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${name} 必须是布尔值`);
  return value;
}
function optionalString(value: unknown, name: string): string | undefined {
  return value === undefined ? undefined : string(value, name);
}
function optionalStringField(value: unknown, key: "build" | "bank", name: string): Partial<Record<"build" | "bank", string>> {
  return value === undefined ? {} : { [key]: string(value, name) };
}
function optionalFinite(value: unknown, name: string): Record<string, number> {
  if (value === undefined) return {};
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${name} 必须是有限数值`);
  return { [name.split(".").at(-1) ?? name]: value };
}
function optionalPositive(value: unknown, name: string): Record<string, number> {
  const result = optionalFinite(value, name);
  const number_ = Object.values(result)[0];
  if (number_ !== undefined && number_ <= 0) throw new Error(`${name} 必须大于 0`);
  return result;
}
function optionalNonNegativeInteger(value: unknown, name: string): Record<string, number> {
  const result = optionalFinite(value, name);
  const number_ = Object.values(result)[0];
  if (number_ !== undefined && (!Number.isInteger(number_) || number_ < 0)) throw new Error(`${name} 必须是非负整数`);
  return result;
}
function optionalStringArray(value: unknown, key: "hiddenLayers" | "hiddenSymbols", name: string): Partial<Record<"hiddenLayers" | "hiddenSymbols", string[]>> {
  if (value === undefined) return {};
  if (!Array.isArray(value)) throw new Error(`${name} 必须是字符串数组`);
  return { [key]: value.map((item, index) => string(item, `${name}[${index}]`)) };
}
function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
