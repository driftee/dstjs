import { describe, expect, it } from "vitest";

import type { WebAnimationManifest } from "@driftee/dstjs-core/web-animation";

import { createDstAnimationPlayer } from "./player.js";
import { renderDstAnimationFrame, webAnimationBounds } from "./render.js";
import type {
  DstAnimationFrameState,
  DstAnimationScheduler,
  DstCanvas2DContext,
} from "./types.js";

function manifest(): WebAnimationManifest {
  return {
    format: "dstjs-web-animation",
    version: 1,
    atlas: { file: "atlas.webp", width: 32, height: 16 },
    sprites: {
      body: { x: 2, y: 3, width: 10, height: 8, originX: 5, originY: 4 },
    },
    animations: {
      idle: {
        frameRate: 10,
        duration: 0.2,
        frames: [
          { elements: [{ sprite: "body", transform: [1, 0, 0, 1, 0, 0], z: 0 }] },
          { elements: [{ sprite: "body", transform: [1, 0, 0, 1, 4, 0], z: 0 }] },
        ],
      },
      wave: {
        frameRate: 10,
        duration: 0.1,
        frames: [
          { elements: [{ sprite: "body", transform: [1, 0, 0, 1, 8, 0], z: 0 }] },
        ],
      },
    },
  };
}

function fakeContext() {
  const calls: Array<{ name: string; arguments: unknown[] }> = [];
  const context: DstCanvas2DContext = {
    canvas: { width: 100, height: 80 },
    clearRect: (...arguments_) => calls.push({ name: "clearRect", arguments: arguments_ }),
    drawImage: (...arguments_) => calls.push({ name: "drawImage", arguments: arguments_ }),
    restore: () => calls.push({ name: "restore", arguments: [] }),
    save: () => calls.push({ name: "save", arguments: [] }),
    setTransform: (...arguments_) => calls.push({ name: "setTransform", arguments: arguments_ }),
    transform: (...arguments_) => calls.push({ name: "transform", arguments: arguments_ }),
  };
  return { calls, context };
}

function fakeScheduler() {
  let nextId = 1;
  const callbacks = new Map<number, (timestamp: number) => void>();
  const scheduler: DstAnimationScheduler = {
    request(callback) {
      const id = nextId;
      nextId += 1;
      callbacks.set(id, callback);
      return id;
    },
    cancel(id) {
      callbacks.delete(id);
    },
  };
  return {
    scheduler,
    advance(timestamp: number) {
      const pending = [...callbacks.values()];
      callbacks.clear();
      for (const callback of pending) callback(timestamp);
    },
    pending: () => callbacks.size,
  };
}

describe("DST.js Canvas player", () => {
  it("renders atlas sprites with native Canvas transforms", () => {
    const { calls, context } = fakeContext();
    const atlas = {} as CanvasImageSource;

    const frame = renderDstAnimationFrame(context, manifest(), atlas, {
      animation: "idle",
      time: 0.1,
      maxScale: 1,
    });

    expect(frame).toBe(1);
    expect(calls).toContainEqual({
      name: "transform",
      arguments: [1, 0, 0, 1, 4, 0],
    });
    expect(calls.find(({ name }) => name === "drawImage")?.arguments).toEqual([
      atlas,
      2,
      3,
      10,
      8,
      -5,
      -4,
      10,
      8,
    ]);
  });

  it("computes transformed bounds across all frames", () => {
    expect(webAnimationBounds(manifest(), "idle")).toEqual({
      left: -5,
      top: -4,
      right: 9,
      bottom: 4,
    });
  });

  it("plays, loops, seeks, and switches animations without UI state", () => {
    const { context } = fakeContext();
    const clock = fakeScheduler();
    const states: DstAnimationFrameState[] = [];
    const player = createDstAnimationPlayer(context, manifest(), {} as CanvasImageSource, {
      scheduler: clock.scheduler,
      loop: true,
      onFrame: (state) => states.push(state),
    });

    player.play();
    expect(clock.pending()).toBe(1);
    clock.advance(0);
    clock.advance(100);
    expect(player.frame).toBe(1);
    clock.advance(250);
    expect(player.currentTime).toBeCloseTo(0);

    player.seek(0.1);
    expect(player.frame).toBe(1);
    player.setAnimation("wave");
    expect(player.animation).toBe("wave");
    expect(player.currentTime).toBe(0);
    expect(states.length).toBeGreaterThan(3);

    player.pause();
    expect(player.playing).toBe(false);
    expect(clock.pending()).toBe(0);
  });

  it("stops at the final frame and reports completion when looping is disabled", () => {
    const { context } = fakeContext();
    const clock = fakeScheduler();
    const ended: DstAnimationFrameState[] = [];
    const player = createDstAnimationPlayer(context, manifest(), {} as CanvasImageSource, {
      scheduler: clock.scheduler,
      loop: false,
      onEnded: (state) => ended.push(state),
    });

    player.play();
    clock.advance(0);
    clock.advance(100);
    clock.advance(200);

    expect(player.playing).toBe(false);
    expect(player.frame).toBe(1);
    expect(ended).toHaveLength(1);
  });


  it("renders scene followers on independent timelines without resetting the total clock", () => {
    const scene = manifest();
    scene.animations.idle!.frames[0]!.elements[0] = {
      ...scene.animations.idle!.frames[0]!.elements[0]!,
      layerName: "HAT",
      symbolName: "swap_hat",
      buildFrame: 0,
    };
    scene.animations.idle!.frames[1]!.elements[0] = {
      ...scene.animations.idle!.frames[1]!.elements[0]!,
      layerName: "HAT",
      symbolName: "swap_hat",
      buildFrame: 0,
    };
    scene.animations.pom = {
      frameRate: 10,
      duration: 0.3,
      frames: [0, 10, 20].map((x) => ({
        elements: [{ sprite: "body", transform: [1, 0, 0, 1, x, 0], z: 0 }],
      })),
    };
    scene.scene = {
      rootAnimation: "idle",
      entities: [{
        id: "pom",
        animation: "pom",
        follow: { layerName: "HAT", x: 5 },
        zOffset: 0.01,
      }],
    };

    const direct = fakeContext();
    renderDstAnimationFrame(direct.context, scene, {} as CanvasImageSource, {
      animation: "idle",
      time: 0.25,
      maxScale: 1,
    });
    const transforms = direct.calls.filter(({ name }) => name === "transform");
    expect(transforms.map(({ arguments: values }) => values)).toEqual([
      [1, 0, 0, 1, 25, 0],
      [1, 0, 0, 1, 0, 0],
    ]);

    const clock = fakeScheduler();
    const player = createDstAnimationPlayer(
      fakeContext().context,
      scene,
      {} as CanvasImageSource,
      { scheduler: clock.scheduler, loop: true },
    );
    player.play();
    clock.advance(0);
    clock.advance(100);
    clock.advance(200);
    clock.advance(300);
    expect(player.currentTime).toBeCloseTo(0.3);
    expect(player.currentTime).toBeGreaterThan(player.duration);

    expect(webAnimationBounds(scene, scene.animations.idle!)).toEqual(
      webAnimationBounds(scene, "idle"),
    );

    const finalContext = fakeContext();
    const finalClock = fakeScheduler();
    const finalPlayer = createDstAnimationPlayer(
      finalContext.context,
      scene,
      {} as CanvasImageSource,
      { scheduler: finalClock.scheduler, loop: false },
    );
    finalPlayer.play();
    finalClock.advance(0);
    finalClock.advance(100);
    finalClock.advance(200);
    const finalTransforms = finalContext.calls.filter(({ name }) => name === "transform").slice(-2);
    expect(finalTransforms.map(({ arguments: values }) => values)).toEqual([
      [1, 0, 0, 1, 19, 0],
      [1, 0, 0, 1, 4, 0],
    ]);
  });
  it("rejects malformed manifests before rendering", () => {
    const { context } = fakeContext();
    const invalid = { ...manifest(), version: 2 };

    expect(() => createDstAnimationPlayer(
      context,
      invalid as unknown as WebAnimationManifest,
      {} as CanvasImageSource,
    )).toThrow("不支持的 Web Animation manifest 版本");
  });
});
