import { describe, expect, it } from "vitest";
import { parsePostProcessorColourCubes, parseSeasonColourCubes } from "./grading.js";

describe("season colour cubes", () => {
  it("reads paired season/phase tables and ignores the commented spring night cube", () => {
    const seasons = ["spring", "summer", "autumn", "winter"].map(season => `${season} = {
      day = "images/colour_cubes/day.tex", dusk = "images/colour_cubes/dusk.tex",
      night = "images/colour_cubes/dusk.tex", -- "images/colour_cubes/night.tex"
      full_moon = "images/colour_cubes/moon.tex"
    }`).join(",");
    const result = parseSeasonColourCubes(`local SEASON_COLOURCUBES = {${seasons}} local CAVE_COLOURCUBES = {}`);
    expect(result.spring?.night).toBe("images/colour_cubes/dusk.tex");
    expect(Object.keys(result)).toHaveLength(4);
  });
  it("rejects incomplete source instead of inventing a filter", () => {
    expect(() => parseSeasonColourCubes("local SEASON_COLOURCUBES = {} local CAVE_COLOURCUBES = {}" )).toThrow();
  });
  it("reads identity and insanity channels used by the native post processor", () => {
    const phases = `day = "images/colour_cubes/insane_day.tex",
      dusk = "images/colour_cubes/insane_dusk.tex", night = "images/colour_cubes/insane_night.tex",
      full_moon = "images/colour_cubes/insane_night.tex"`;
    const seasons = ["spring", "summer", "autumn", "winter"].map(season => `${season} = {
      day = "images/colour_cubes/day.tex", dusk = "images/colour_cubes/dusk.tex",
      night = "images/colour_cubes/night.tex", full_moon = "images/colour_cubes/moon.tex"
    }`).join(",");
    const result = parsePostProcessorColourCubes(`
      local IDENTITY_COLOURCUBE = "images/colour_cubes/identity.tex"
      local INSANITY_COLOURCUBES = { ${phases} }
      local LUNACY_COLOURCUBES = {
        regular = "images/colour_cubes/lunacy.tex",
        full_moon = "images/colour_cubes/moon.tex",
        moon_storm = "images/colour_cubes/storm.tex"
      }
      local SEASON_COLOURCUBES = { ${seasons} }
      local CAVE_COLOURCUBES = {}`);
    expect(result.identity).toBe("images/colour_cubes/identity.tex");
    expect(result.insanity.full_moon).toBe("images/colour_cubes/insane_night.tex");
    expect(result.lunacy.regular).toBe("images/colour_cubes/lunacy.tex");
    expect(result.lunacy.full_moon).toBe("images/colour_cubes/moon.tex");
    expect(result.lunacy.moon_storm).toBe("images/colour_cubes/storm.tex");
    expect(result.seasons.winter?.full_moon).toBe("images/colour_cubes/moon.tex");
  });
});
