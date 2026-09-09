import type { WebAnimationManifest } from "@driftee/dstjs-core/web-animation";
import type {
  Group,
  Material,
  Texture,
} from "three";

export type CreateDstThreeAnimationSourceOptions = {
  material?: Material;
  disposeTexture?: boolean;
};

export type CreateDstThreeAnimationOptions = {
  animation?: string;
  loop?: boolean;
  playbackRate?: number;
  playing?: boolean;
  renderOrder?: number;
};

export type DstThreeAnimation = {
  readonly object: Group;
  readonly animation: string;
  readonly currentTime: number;
  readonly duration: number;
  readonly frame: number;
  readonly playing: boolean;
  play(): void;
  pause(): void;
  replay(): void;
  seek(time: number): void;
  setAnimation(animation: string): void;
  setLoop(loop: boolean): void;
  setPlaybackRate(playbackRate: number): void;
  setRenderOrder(renderOrder: number): void;
  update(deltaSeconds: number): void;
  render(): void;
  destroy(): void;
};

export type DstThreeAnimationSource = {
  readonly manifest: WebAnimationManifest;
  readonly texture: Texture;
  createInstance(options?: CreateDstThreeAnimationOptions): DstThreeAnimation;
  dispose(): void;
};
