import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

type StateDefinition = {
  id: string;
  label: string;
  animation: string;
  frame?: "last";
  snow?: boolean;
};

type Manifest = {
  buildings: Array<{ id: string }>;
  walls: Array<{
    id: string;
    archive: string;
    buildArchive?: string;
    wideArchive?: string;
    animation: string;
    swingRightAnimation?: string;
    eightFacings?: boolean;
  }>;
  plants: Array<{ id: string; states: StateDefinition[] }>;
};

describe("home building animation manifest", () => {
  it("keeps one unique source entry for every toolbox object", async () => {
    const manifest = await loadManifest();
    const ids = [...manifest.buildings, ...manifest.plants, ...manifest.walls].map(entry => entry.id);

    expect(ids).toHaveLength(58);
    expect(new Set(ids).size).toBe(ids.length);
    expect(manifest.plants).toHaveLength(11);
    expect(manifest.walls).toHaveLength(9);
  });

  it("exports stable plant states instead of looping transition clips", async () => {
    const manifest = await loadManifest();

    for (const plant of manifest.plants) {
      expect(plant.states.length).toBeGreaterThan(0);
      expect(new Set(plant.states.map(state => state.id)).size).toBe(plant.states.length);
      expect(plant.states.some(state => state.id === "picked")).toBe(false);
      for (const state of plant.states) {
        expect(state.label).not.toBe("");
        if (["picked", "empty", "dead", "idle_dead"].includes(state.animation)) {
          expect(state.frame).toBe("last");
        }
        if (state.id.endsWith("-snow")) expect(state.snow).toBe(true);
      }
    }
  });

  it("exports walls and rotatable fence objects from their eight-faced animations", async () => {
    const manifest = await loadManifest();

    for (const wall of manifest.walls.filter(entry => entry.id.startsWith("wall_"))) {
      expect(wall.id).toMatch(/^wall_/);
      expect(wall.animation).toBe("half");
      if (wall.id === "wall_dreadstone") {
        expect(wall.archive).toBe("wall_dreadstone");
        expect(wall.buildArchive).toBeUndefined();
      } else {
        expect(wall.archive).toBe("wall");
        expect(wall.buildArchive).toBe(wall.id);
      }
    }

    for (const fence of manifest.walls.filter(entry => !entry.id.startsWith("wall_"))) {
      expect(["fence", "fence_gate"]).toContain(fence.id);
      expect(fence.animation).toBe("idle");
      expect(fence.wideArchive).toBe(fence.id);
      expect(fence.eightFacings).toBe(true);
    }
    expect(manifest.walls.find(entry => entry.id === "fence_gate")?.swingRightAnimation)
      .toBe("idleright");
  });
});

async function loadManifest(): Promise<Manifest> {
  return JSON.parse(await readFile(
    new URL("../../scripts/home-building-animations.json", import.meta.url),
    "utf8",
  )) as Manifest;
}
