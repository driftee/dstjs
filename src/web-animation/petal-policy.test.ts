import { describe, expect, it } from "vitest";

import { petalDensityForViewport, petalThemeForDate, petalWindAngleAt } from "./petal-policy.js";

function localDate(year: number, month: number, day: number): Date {
  return new Date(year, month - 1, day, 12);
}

describe("petal effect policy", () => {
  it.each([
    [localDate(2026, 1, 1), "hibeescus"],
    [localDate(2026, 5, 1), "hibeescus"],
    [localDate(2026, 5, 3), "hibeescus"],
    [localDate(2026, 10, 1), "hibeescus"],
    [localDate(2026, 10, 7), "hibeescus"],
    [localDate(2026, 12, 25), "hibeescus"],
  ])("uses the holiday theme on %s", (date, expected) => {
    expect(petalThemeForDate(date)).toBe(expected);
  });

  it("prefers weekends over seasons outside holidays", () => {
    expect(petalThemeForDate(localDate(2026, 5, 2))).toBe("hibeescus");
    expect(petalThemeForDate(localDate(2026, 5, 9))).toBe("cheerful");
  });

  it("uses northern-hemisphere seasons on ordinary weekdays", () => {
    expect(petalThemeForDate(localDate(2026, 2, 2))).toBe("winter");
    expect(petalThemeForDate(localDate(2026, 4, 6))).toBe("spring");
    expect(petalThemeForDate(localDate(2026, 7, 6))).toBe("summer");
    expect(petalThemeForDate(localDate(2026, 11, 2))).toBe("autumn");
  });

  it("scales density linearly around the reference viewport with safety limits", () => {
    expect(petalDensityForViewport(1_440, 900)).toBe(14);
    expect(petalDensityForViewport(2_880, 900)).toBe(28);
    expect(petalDensityForViewport(320, 480)).toBe(4);
    expect(petalDensityForViewport(8_000, 8_000)).toBe(40);
  });

  it("varies wind smoothly with time", () => {
    expect(petalWindAngleAt(0)).toBe(18);
    expect(petalWindAngleAt(10_000)).not.toBe(petalWindAngleAt(20_000));
  });
});
