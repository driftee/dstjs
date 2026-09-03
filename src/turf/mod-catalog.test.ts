import { describe, expect, it } from "vitest";

import { parseModTileDefinitions } from "./mod-catalog.js";

describe("mod turf catalog", () => {
  it("解析 AddTile 与原版相对渲染顺序", () => {
    const result = parseModTileDefinitions(`
      AddTile("CHERRY", "LAND", { ground_name = "Grove Petal" }, {
        name = "cherry",
        noise_texture = "noise_cherry",
        flooring = true,
      }, nil, {
        name = "cherry",
        invicon_override = "cherry_icon",
      })
      AddTile("TEMP", "LAND", { ground_name = "Temporary" }, {
        name = "temp",
        noise_texture = "noise_temp",
      })
      ChangeTileRenderOrder(WORLD_TILES.CHERRY, WORLD_TILES.GRASS)
      ChangeTileRenderOrder(WORLD_TILES.TEMP, WORLD_TILES.WOODFLOOR, true)
    `);

    expect(result).toEqual([
      expect.objectContaining({
        key: "cherry",
        inventory: "turf_cherry",
        inventoryIcon: "turf_cherry_icon",
        flooring: true,
        insertion: { target: "grass", after: false },
      }),
      expect.objectContaining({
        key: "temp",
        inventory: null,
        insertion: { target: "woodfloor", after: true },
      }),
    ]);
  });

  it("拒绝动态资源声明", () => {
    expect(() => parseModTileDefinitions(`
      AddTile("DYNAMIC", "LAND", {}, { name = tile_name, noise_texture = "noise" })
    `)).toThrow(/动态地皮资源/);
  });
});
