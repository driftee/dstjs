export const SEASONS = [
  { value: 'spring', label: '春' }, { value: 'summer', label: '夏' },
  { value: 'autumn', label: '秋' }, { value: 'winter', label: '冬' }, { value: 'none', label: '无滤镜' },
] as const;
export const PHASES = [
  { value: 'day', label: '白天' }, { value: 'dusk', label: '黄昏' }, { value: 'night', label: '夜晚' },
  { value: 'full_moon', label: '满月' },
] as const;
export type Season = typeof SEASONS[number]['value'];
export type Phase = typeof PHASES[number]['value'];
export type MentalMode = 'sanity' | 'enlightenment';
export type GradingSettings = {
  season: Season;
  phase: Phase;
  strength: number;
  sanity: number;
  mentalMode: MentalMode;
};
export const DEFAULT_GRADING: GradingSettings = {
  season: 'autumn',
  phase: 'day',
  strength: 1,
  sanity: 1,
  mentalMode: 'sanity',
};
export type GradingManifest = {
  format: string; dimension: number; cubes: Record<string, string>;
  identity: string;
  seasons: Record<string, Record<string, string>>;
  insanity: Record<string, string>;
  lunacy: Record<'regular' | 'full_moon' | 'moon_storm', string>;
};
export const CUBE_SIZE = 32;
export const CUBE_BYTES = CUBE_SIZE ** 3 * 4;

/** Reproduce combine_colour_cubes.ksh: channel 0 is one season×phase LUT;
 * channel 1 is insanity mixed by (1-sanity)^2, or channel 2 is lunacy mixed
 * by sanity^2. Lunar Island uses the regular lunacy cube outside full moon.
 * `strength` is a preview-only identity→native comparison control. At 1 the
 * ambient channel is the exact steady-state game LUT; the game itself does
 * not expose separate season and time strengths.
 */
export function buildColourCube(manifest: GradingManifest, cubes: Map<string, Uint8Array>, settings: GradingSettings): Float32Array | null {
  if (settings.season === 'none') return null;
  const strength = clamp01(settings.strength);
  const sanity = clamp01(settings.sanity);
  const get = (path: string | undefined, label: string) => {
    const result = path ? cubes.get(path) : undefined;
    if (!result || result.length !== CUBE_BYTES) throw new Error(`缺少调色表：${label}`);
    return result;
  };
  const identity = get(manifest.identity, 'identity');
  const ambient = get(manifest.seasons[settings.season]?.[settings.phase], `${settings.season}/${settings.phase}`);
  const mentalPath = settings.mentalMode === 'enlightenment'
    ? manifest.lunacy[settings.phase === 'full_moon' ? 'full_moon' : 'regular']
    : manifest.insanity[settings.phase];
  const mental = get(mentalPath, `${settings.mentalMode}/${settings.phase}`);
  const mentalWeight = settings.mentalMode === 'enlightenment' ? sanity ** 2 : (1 - sanity) ** 2;
  if (strength === 0 && mentalWeight === 0) return null;
  const result = new Float32Array(CUBE_BYTES);
  for (let i = 0; i < CUBE_BYTES; i += 4) {
    for (let channel = 0; channel < 3; channel++) {
      const j = i + channel;
      const ambientColour = identity[j]! * (1 - strength) + ambient[j]! * strength;
      result[j] = ambientColour * (1 - mentalWeight) + mental[j]! * mentalWeight;
    }
    result[i + 3] = 255;
  }
  return result;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** Trilinear sampling of the 32³ RGB cube (x = b*32+r, y = g). */
export function gradePixels(source: Uint8ClampedArray, cube: Float32Array | null): Uint8ClampedArray {
  const output = new Uint8ClampedArray(source);
  if (!cube) return output;
  if (cube.length !== CUBE_BYTES) throw new Error('调色表尺寸错误');
  for (let i = 0; i < source.length; i += 4) {
    if (!source[i + 3]!) continue;
    const r = source[i]! * 31 / 255, g = source[i + 1]! * 31 / 255, b = source[i + 2]! * 31 / 255;
    const r0 = Math.floor(r), g0 = Math.floor(g), b0 = Math.floor(b);
    const dr = r - r0, dg = g - g0, db = b - b0;
    const ri = r0 * 4, gi = g0 * 4096, bi = b0 * 128;
    const rx = Math.min(r0 + 1, 31) * 4, gx = Math.min(g0 + 1, 31) * 4096, bx = Math.min(b0 + 1, 31) * 128;
    for (let c = 0; c < 3; c++) {
      const low0 = cube[gi + bi + ri + c]! * (1 - dr) + cube[gi + bi + rx + c]! * dr;
      const low1 = cube[gx + bi + ri + c]! * (1 - dr) + cube[gx + bi + rx + c]! * dr;
      const high0 = cube[gi + bx + ri + c]! * (1 - dr) + cube[gi + bx + rx + c]! * dr;
      const high1 = cube[gx + bx + ri + c]! * (1 - dr) + cube[gx + bx + rx + c]! * dr;
      output[i + c] = (low0 * (1 - dg) + low1 * dg) * (1 - db) + (high0 * (1 - dg) + high1 * dg) * db;
    }
  }
  return output;
}

/** Fit the 3D LUT to an affine RGB transform for browser-native animated
 * images. SVG feColorMatrix cannot represent a nonlinear 3D LUT exactly, but
 * this least-squares projection preserves its overall tint and channel mixing
 * without decoding every animated WebP frame on the main thread.
 */
export function fitColourCubeMatrix(cube: Float32Array | null): string | null {
  if (!cube) return null;
  if (cube.length !== CUBE_BYTES) throw new Error('调色表尺寸错误');
  const count = CUBE_SIZE ** 3;
  const meanInput = .5;
  let variance = 0;
  for (let value = 0; value < CUBE_SIZE; value++) {
    const centered = value / (CUBE_SIZE - 1) - meanInput;
    variance += centered * centered;
  }
  variance /= CUBE_SIZE;
  const rows: number[][] = [];
  for (let channel = 0; channel < 3; channel++) {
    let mean = 0, covarianceR = 0, covarianceG = 0, covarianceB = 0;
    for (let g = 0; g < CUBE_SIZE; g++) for (let b = 0; b < CUBE_SIZE; b++) for (let r = 0; r < CUBE_SIZE; r++) {
      const index = (g * CUBE_SIZE ** 2 + b * CUBE_SIZE + r) * 4 + channel;
      const output = cube[index]! / 255;
      mean += output;
      covarianceR += (r / (CUBE_SIZE - 1) - meanInput) * output;
      covarianceG += (g / (CUBE_SIZE - 1) - meanInput) * output;
      covarianceB += (b / (CUBE_SIZE - 1) - meanInput) * output;
    }
    mean /= count;
    const denominator = count * variance;
    const slopes = [covarianceR / denominator, covarianceG / denominator, covarianceB / denominator];
    rows.push([...slopes, 0, mean - meanInput * slopes.reduce((sum, value) => sum + value, 0)]);
  }
  return [...rows.flat(), 0, 0, 0, 1, 0].map(value => Math.abs(value) < 1e-10 ? 0 : Number(value.toFixed(7))).join(' ');
}
