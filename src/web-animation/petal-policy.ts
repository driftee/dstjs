export type PetalTheme = "spring" | "summer" | "autumn" | "winter" | "cheerful" | "hibeescus";

export function petalThemeForDate(date: Date): PetalTheme {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const holiday = (month === 1 && day === 1)
    || (month === 5 && day >= 1 && day <= 3)
    || (month === 10 && day >= 1 && day <= 7)
    || (month === 12 && day === 25);
  if (holiday) return "hibeescus";
  if (date.getDay() === 0 || date.getDay() === 6) return "cheerful";
  if (month >= 3 && month <= 5) return "spring";
  if (month >= 6 && month <= 8) return "summer";
  if (month >= 9 && month <= 11) return "autumn";
  return "winter";
}

export function petalDensityForViewport(width: number, height: number): number {
  const baselineArea = 1_440 * 900;
  return Math.max(4, Math.min(40, Math.round(width * height * 14 / baselineArea)));
}

export function petalWindAngleAt(timeMilliseconds: number): number {
  const seconds = timeMilliseconds / 1_000;
  return 18
    + 34 * Math.sin(seconds * Math.PI * 2 / 90)
    + 9 * Math.sin(seconds * Math.PI * 2 / 27);
}
