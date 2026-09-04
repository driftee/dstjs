import type {
  WebAnimationManifest,
} from "@driftee/dstjs-core/web-animation";

export type DstAnimationFit = "contain" | "cover" | "none";

export type DstAnimationBounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export type DstAnimationFrameState = {
  animation: string;
  currentTime: number;
  duration: number;
  frame: number;
  playing: boolean;
};

export type DstAnimationScheduler = {
  request(callback: (timestamp: number) => void): number;
  cancel(requestId: number): void;
};

export type DstCanvas2DContext = {
  readonly canvas: {
    readonly width: number;
    readonly height: number;
  };
  clearRect(x: number, y: number, width: number, height: number): void;
  drawImage(
    image: CanvasImageSource,
    sourceX: number,
    sourceY: number,
    sourceWidth: number,
    sourceHeight: number,
    destinationX: number,
    destinationY: number,
    destinationWidth: number,
    destinationHeight: number,
  ): void;
  restore(): void;
  save(): void;
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  transform(a: number, b: number, c: number, d: number, e: number, f: number): void;
};

export type RenderDstAnimationFrameOptions = {
  animation: string;
  time: number;
  fit?: DstAnimationFit;
  padding?: number;
  maxScale?: number;
  clear?: boolean;
};

export type CreateDstAnimationPlayerOptions = {
  animation?: string;
  autoplay?: boolean;
  loop?: boolean;
  playbackRate?: number;
  fit?: DstAnimationFit;
  padding?: number;
  maxScale?: number;
  clear?: boolean;
  scheduler?: DstAnimationScheduler;
  onFrame?: (state: DstAnimationFrameState) => void;
  onEnded?: (state: DstAnimationFrameState) => void;
};

export type DstAnimationPlayer = {
  readonly animation: string;
  readonly currentTime: number;
  readonly duration: number;
  readonly frame: number;
  readonly playing: boolean;
  play(): void;
  pause(): void;
  replay(): void;
  render(): void;
  seek(time: number): void;
  setAnimation(animation: string): void;
  setLoop(loop: boolean): void;
  setPlaybackRate(playbackRate: number): void;
  destroy(): void;
};

export type DstAnimationPlayerSource = {
  manifest: WebAnimationManifest;
  atlas: CanvasImageSource;
};
