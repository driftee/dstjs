import { describe, expect, it } from "vitest";

import { parseVanillaTileDefinitions } from "./definitions.js";

describe("vanilla tile definitions", () => {
  it("keeps MONKEY_DOCK separate from inventory turf declarations", () => {
    const [dock] = parseVanillaTileDefinitions(`
      TileManager.AddTile("MONKEY_DOCK", TileRanges.LAND, {ground_name="Docks"},
        {name="cave", noise_texture="ground_noise_dock", cannotbedug=true, flooring=true, istemptile=true},
        {name="map_edge", noise_texture="mini_dock_noise"})
    `);
    expect(dock).toMatchObject({ key: "monkey_dock", atlas: "cave", noise: "ground_noise_dock", inventory: null, flooring: true });
  });

  it("preserves registration order, not numeric IDs or inventory names", () => {
    const result = parseVanillaTileDefinitions(`
      -- TileManager.AddTile("BAD", TileRanges.LAND)
      TileManager.AddTile("ROCKY", TileRanges.LAND,
        { ground_name = "Rocky, (ground)", old_static_id = GROUND.ROCKY },
        { name = "rocky", noise_texture = "noise_rocky", colors = { x = {1, 2} } },
        { name = "map_edge" }, { name = "rocky" })
      TileManager.AddTile("CHECKER", TileRanges.LAND, {},
        { name = "blocky", noise_texture = "noise_checker", flooring = true },
        { name = "map_edge" }, { name = "checkerfloor", anim = "checker", invicon_override = "checker_icon" })
    `);
    expect(result.map((tile) => [tile.key, tile.renderOrder])).toEqual([["rocky", 0], ["checker", 1]]);
    expect(result[0]?.groundName).toBe("Rocky, (ground)");
    expect(result[1]).toMatchObject({ inventory: "turf_checkerfloor", inventoryIcon: "turf_checker_icon", atlas: "blocky", flooring: true });
  });

  it("does not invent inventory items for dirt, sea or temporary tiles", () => {
    const result = parseVanillaTileDefinitions(`
      --[[ TileManager.AddTile("FAKE", TileRanges.LAND) ]]
      TileManager.AddTile("IMPASSABLE", TileRanges.IMPASSABLE, {})
      TileManager.AddTile("DIRT", TileRanges.LAND, {}, {name='dirt', noise_texture='images/square.tex'}, {name='map_edge'})
    `);
    expect(result).toHaveLength(2);
    expect(result.every((tile) => tile.inventory === null)).toBe(true);
    expect(result[1]?.noise).toBe("images/square.tex");
  });

  it("rejects unknown dynamic resources and order mutations instead of guessing", () => {
    expect(() => parseVanillaTileDefinitions('TileManager.AddTile("X", TileRanges.LAND, {}, {name=some_var})')).toThrow();
    expect(() => parseVanillaTileDefinitions('TileManager.ChangeTileRenderOrder(GROUND.X, GROUND.Y)')).toThrow(/review/);
    expect(() => parseVanillaTileDefinitions('TileManager.AddTile("X", TileRanges.LAND, {}')).toThrow(/Unclosed/);
  });
});
