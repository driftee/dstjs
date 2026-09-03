import { readFileSync } from "node:fs";
import { runInNewContext, Script } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const html = readFileSync(new URL("../../examples/all-things-atmosphere/index.html", import.meta.url), "utf8");
const clipCode = html.slice(html.indexOf("function drawClip("), html.indexOf("function resetFirefly("));
const skyCode = html.slice(html.indexOf("function drawSky("), html.indexOf("function drawFireflies("));

describe("atmosphere preview", () => {
  it("removes the central card but retains controls and valid script", () => {
    expect(html).not.toContain('class="card"');
    expect(html).toContain('class="controls"');
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    expect(script).toBeTruthy();
    expect(() => new Script(script!)).not.toThrow();
  });

  it("flips only sky around its clip centre without moving the anchor", () => {
    const context = { save: vi.fn(), restore: vi.fn(), translate: vi.fn(), scale: vi.fn() };
    const data = { manifest: {}, atlas: {}, bounds: { left: 0, right: 100, top: 0, bottom: 40 },
      clip: { duration: 1, frameRate: 1, frames: [{ elements: [] }] } };
    runInNewContext(clipCode + '\ndrawClip(context, data, 0, 200, 80, 2, .88, true);', { context, data });
    expect(context.translate.mock.calls).toEqual([[200, 80], [-50, -20]]);
    expect(context.scale).toHaveBeenLastCalledWith(2, -2);
    runInNewContext(clipCode + '\ndrawClip(context, data, 0, 200, 80, 2, .88);', { context, data });
    expect(context.scale).toHaveBeenLastCalledWith(2, 2);
    const drawClip = vi.fn();
    runInNewContext(skyCode + '\ndrawSky();', {
      clear: vi.fn(), contexts: { sky: context }, skyInput: { checked: true },
      packages: { sky: data }, width: 400, height: 400, elapsed: 0, drawClip,
    });
    expect(drawClip.mock.calls[0]?.[7]).toBe(true);
  });
});
