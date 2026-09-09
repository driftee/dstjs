import {
  animationFrameAtTime,
  parseWebAnimationManifest,
  selectWebAnimation,
  type WebAnimationManifest,
  type WebAnimationSprite,
} from "@driftee/dstjs-core/web-animation";
import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  type Material,
  type Texture,
} from "three";

import type {
  CreateDstThreeAnimationOptions,
  CreateDstThreeAnimationSourceOptions,
  DstThreeAnimation,
  DstThreeAnimationSource,
} from "./types.js";

const MAX_FRAME_DELTA_SECONDS = 0.1;

export function createDstThreeAnimationSource(
  manifestInput: WebAnimationManifest,
  texture: Texture,
  options: CreateDstThreeAnimationSourceOptions = {},
): DstThreeAnimationSource {
  const manifest = parseWebAnimationManifest(manifestInput);
  const geometries = new Map<string, BufferGeometry>();
  const material = options.material ?? new MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const ownsMaterial = options.material == null;
  const instances = new Set<DstThreeAnimation>();
  let disposed = false;

  const source: DstThreeAnimationSource = {
    manifest,
    texture,
    createInstance(instanceOptions = {}) {
      if (disposed) throw new Error("Three.js 动画资源已销毁");
      const instance = createInstance(
        manifest,
        material,
        (spriteId) => {
          let geometry = geometries.get(spriteId);
          if (geometry) return geometry;
          const sprite = manifest.sprites[spriteId];
          if (!sprite) throw new Error(`动画引用了不存在的 Sprite ${spriteId}`);
          geometry = createSpriteGeometry(sprite, manifest.atlas.width, manifest.atlas.height);
          geometries.set(spriteId, geometry);
          return geometry;
        },
        instanceOptions,
        () => instances.delete(instance),
      );
      instances.add(instance);
      return instance;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const instance of [...instances]) instance.destroy();
      for (const geometry of geometries.values()) geometry.dispose();
      geometries.clear();
      if (ownsMaterial) material.dispose();
      if (options.disposeTexture) texture.dispose();
    },
  };
  return source;
}

function createInstance(
  manifest: WebAnimationManifest,
  material: Material,
  geometryFor: (spriteId: string) => BufferGeometry,
  options: CreateDstThreeAnimationOptions,
  onDestroy: () => void,
): DstThreeAnimation {
  const animationNames = Object.keys(manifest.animations);
  const initialAnimation = options.animation ?? animationNames[0];
  if (!initialAnimation) throw new Error("Web Animation manifest 不包含动画");
  let animation: string = initialAnimation;
  selectWebAnimation(manifest, animation);
  let currentTime = 0;
  let loop = options.loop ?? true;
  let playbackRate = validatePlaybackRate(options.playbackRate ?? 1);
  let playing = options.playing ?? false;
  let destroyed = false;
  let renderOrder = options.renderOrder ?? 0;
  const object = new Group();
  const meshes: Mesh[] = [];

  const render = (): void => {
    assertActive();
    const clip = selectWebAnimation(manifest, animation);
    const frameIndex = animationFrameAtTime(clip, currentTime);
    const frame = clip.frames[frameIndex];
    if (!frame) throw new Error(`动画 ${animation} 不包含可渲染帧`);
    while (meshes.length < frame.elements.length) {
      const mesh = new Mesh(undefined, material);
      mesh.matrixAutoUpdate = false;
      mesh.frustumCulled = false;
      object.add(mesh);
      meshes.push(mesh);
    }
    for (let index = 0; index < meshes.length; index += 1) {
      const mesh = meshes[index]!;
      const element = frame.elements[index];
      if (!element) {
        mesh.visible = false;
        continue;
      }
      mesh.visible = true;
      mesh.geometry = geometryFor(element.sprite);
      mesh.renderOrder = renderOrder + index;
      applyCanvasTransform(mesh.matrix, element.transform, element.z);
      mesh.matrixWorldNeedsUpdate = true;
    }
  };

  const instance: DstThreeAnimation = {
    object,
    get animation() {
      return animation;
    },
    get currentTime() {
      return currentTime;
    },
    get duration() {
      return selectWebAnimation(manifest, animation).duration;
    },
    get frame() {
      return animationFrameAtTime(selectWebAnimation(manifest, animation), currentTime);
    },
    get playing() {
      return playing;
    },
    play() {
      assertActive();
      if (currentTime >= instance.duration) currentTime = 0;
      playing = true;
    },
    pause() {
      assertActive();
      playing = false;
    },
    replay() {
      assertActive();
      currentTime = 0;
      playing = true;
      render();
    },
    seek(time: number) {
      assertActive();
      if (!Number.isFinite(time)) throw new Error(`动画时间无效：${time}`);
      currentTime = Math.min(instance.duration, Math.max(0, time));
      render();
    },
    setAnimation(nextAnimation: string) {
      assertActive();
      selectWebAnimation(manifest, nextAnimation);
      animation = nextAnimation;
      currentTime = 0;
      render();
    },
    setLoop(nextLoop: boolean) {
      assertActive();
      loop = nextLoop;
    },
    setPlaybackRate(nextPlaybackRate: number) {
      assertActive();
      playbackRate = validatePlaybackRate(nextPlaybackRate);
    },
    setRenderOrder(nextRenderOrder: number) {
      assertActive();
      if (!Number.isFinite(nextRenderOrder)) {
        throw new Error(`渲染顺序无效：${nextRenderOrder}`);
      }
      if (renderOrder === nextRenderOrder) return;
      renderOrder = nextRenderOrder;
      render();
    },
    update(deltaSeconds: number) {
      assertActive();
      if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) {
        throw new Error(`动画时间增量无效：${deltaSeconds}`);
      }
      if (!playing) return;
      const duration = instance.duration;
      currentTime += Math.min(deltaSeconds, MAX_FRAME_DELTA_SECONDS) * playbackRate;
      if (currentTime >= duration) {
        if (loop) currentTime %= duration;
        else {
          currentTime = duration;
          playing = false;
        }
      }
      render();
    },
    render,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      playing = false;
      object.remove(...meshes);
      meshes.length = 0;
      onDestroy();
    },
  };
  render();
  return instance;

  function assertActive(): void {
    if (destroyed) throw new Error("Three.js 动画实例已销毁");
  }
}

function createSpriteGeometry(
  sprite: WebAnimationSprite,
  atlasWidth: number,
  atlasHeight: number,
): BufferGeometry {
  const left = -sprite.originX;
  const right = sprite.width - sprite.originX;
  const top = sprite.originY;
  const bottom = sprite.originY - sprite.height;
  const u0 = sprite.x / atlasWidth;
  const u1 = (sprite.x + sprite.width) / atlasWidth;
  const v0 = 1 - sprite.y / atlasHeight;
  const v1 = 1 - (sprite.y + sprite.height) / atlasHeight;
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute([
    left, top, 0,
    right, top, 0,
    right, bottom, 0,
    left, bottom, 0,
  ], 3));
  geometry.setAttribute("uv", new Float32BufferAttribute([
    u0, v0,
    u1, v0,
    u1, v1,
    u0, v1,
  ], 2));
  geometry.setIndex([0, 2, 1, 0, 3, 2]);
  return geometry;
}

function applyCanvasTransform(
  matrix: Matrix4,
  transform: readonly [number, number, number, number, number, number],
  z: number,
): void {
  const [a, b, c, d, tx, ty] = transform;
  matrix.set(
    a, -c, 0, tx,
    -b, d, 0, -ty,
    0, 0, 1, z,
    0, 0, 0, 1,
  );
}

function validatePlaybackRate(value: number): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`播放速度无效：${value}`);
  return value;
}
