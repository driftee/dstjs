import {
  parseWebAnimationManifest,
  type WebAnimationManifest,
} from "@driftee/dstjs-core/web-animation";

import { animationFrameAtTime, renderDstAnimationFrame } from "./render.js";
import type {
  CreateDstAnimationPlayerOptions,
  DstAnimationFrameState,
  DstAnimationPlayer,
  DstAnimationScheduler,
  DstCanvas2DContext,
} from "./types.js";

const MAX_FRAME_DELTA_SECONDS = 0.1;

export function createDstAnimationPlayer(
  context: DstCanvas2DContext,
  manifestInput: WebAnimationManifest,
  atlas: CanvasImageSource,
  options: CreateDstAnimationPlayerOptions = {},
): DstAnimationPlayer {
  const manifest = parseWebAnimationManifest(manifestInput);
  const animationNames = Object.keys(manifest.animations);
  const initialAnimation = options.animation ?? animationNames[0];
  if (!initialAnimation || !manifest.animations[initialAnimation]) {
    throw new Error(`找不到动画 ${initialAnimation ?? ""}`);
  }
  let animation: string = initialAnimation;
  let currentTime = 0;
  let playing = false;
  let loop = options.loop ?? true;
  let playbackRate = validatePlaybackRate(options.playbackRate ?? 1);
  let scheduler = options.scheduler;
  let frameRequest: number | null = null;
  let previousTimestamp: number | null = null;
  let destroyed = false;

  const isLoopingScene = () => loop && manifest.scene?.rootAnimation === animation;
  const frameAtCurrentTime = (clip: NonNullable<WebAnimationManifest["animations"][string]>) => {
    const time = isLoopingScene()
      ? ((currentTime % clip.duration) + clip.duration) % clip.duration
      : currentTime;
    return animationFrameAtTime(clip, time);
  };

  const state = (): DstAnimationFrameState => {
    const clip = manifest.animations[animation];
    if (!clip) throw new Error(`找不到动画 ${animation}`);
    return {
      animation,
      currentTime,
      duration: clip.duration,
      frame: frameAtCurrentTime(clip),
      playing,
    };
  };

  const render = (): void => {
    assertActive();
    const clip = manifest.animations[animation];
    if (!clip) throw new Error(`找不到动画 ${animation}`);
    const renderTime = !loop && manifest.scene?.rootAnimation === animation
      ? Math.min(currentTime, Math.max(0, clip.duration - 1 / clip.frameRate))
      : currentTime;
    renderDstAnimationFrame(context, manifest, atlas, {
      animation,
      time: renderTime,
      fit: options.fit,
      padding: options.padding,
      maxScale: options.maxScale,
      clear: options.clear,
    });
    options.onFrame?.(state());
  };

  const scheduleNextFrame = (): void => {
    scheduler ??= defaultScheduler();
    frameRequest = scheduler.request(tick);
  };

  const tick = (timestamp: number): void => {
    frameRequest = null;
    if (!playing || destroyed) return;
    const clip = manifest.animations[animation];
    if (!clip) throw new Error(`找不到动画 ${animation}`);
    if (previousTimestamp !== null) {
      const elapsed = Math.max(0, Math.min(
        MAX_FRAME_DELTA_SECONDS,
        (timestamp - previousTimestamp) / 1000,
      ));
      currentTime += elapsed * playbackRate;
      if (currentTime >= clip.duration) {
        if (loop) {
          if (!isLoopingScene()) currentTime %= clip.duration;
        }
        else {
          currentTime = clip.duration;
          playing = false;
        }
      }
    }
    previousTimestamp = timestamp;
    render();
    if (playing) scheduleNextFrame();
    else options.onEnded?.(state());
  };

  const pause = (): void => {
    if (frameRequest !== null && scheduler) scheduler.cancel(frameRequest);
    frameRequest = null;
    previousTimestamp = null;
    playing = false;
  };

  const player: DstAnimationPlayer = {
    get animation() {
      return animation;
    },
    get currentTime() {
      return currentTime;
    },
    get duration() {
      return manifest.animations[animation]?.duration ?? 0;
    },
    get frame() {
      const clip = manifest.animations[animation];
      if (!clip) return 0;
      return frameAtCurrentTime(clip);
    },
    get playing() {
      return playing;
    },
    play() {
      assertActive();
      if (playing) return;
      const clip = manifest.animations[animation];
      if (!clip) throw new Error(`找不到动画 ${animation}`);
      if (currentTime >= clip.duration && !isLoopingScene()) currentTime = 0;
      playing = true;
      previousTimestamp = null;
      scheduleNextFrame();
    },
    pause,
    replay() {
      assertActive();
      currentTime = 0;
      render();
      player.play();
    },
    render,
    seek(time: number) {
      assertActive();
      if (!Number.isFinite(time)) throw new Error(`动画时间无效：${time}`);
      const clip = manifest.animations[animation];
      if (!clip) throw new Error(`找不到动画 ${animation}`);
      currentTime = isLoopingScene()
        ? Math.max(0, time)
        : Math.min(clip.duration, Math.max(0, time));
      render();
    },
    setAnimation(nextAnimation: string) {
      assertActive();
      if (!manifest.animations[nextAnimation]) throw new Error(`找不到动画 ${nextAnimation}`);
      animation = nextAnimation;
      currentTime = 0;
      previousTimestamp = null;
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
    destroy() {
      if (destroyed) return;
      pause();
      destroyed = true;
    },
  };

  render();
  if (options.autoplay) player.play();
  return player;

  function assertActive(): void {
    if (destroyed) throw new Error("播放器已销毁");
  }
}

function validatePlaybackRate(value: number): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`播放速度无效：${value}`);
  return value;
}

function defaultScheduler(): DstAnimationScheduler {
  if (
    typeof globalThis.requestAnimationFrame !== "function"
    || typeof globalThis.cancelAnimationFrame !== "function"
  ) {
    throw new Error("当前环境不支持 requestAnimationFrame，请传入 scheduler");
  }
  return {
    request: globalThis.requestAnimationFrame.bind(globalThis),
    cancel: globalThis.cancelAnimationFrame.bind(globalThis),
  };
}
