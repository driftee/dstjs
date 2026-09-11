import { describe, expect, it } from 'vitest';
import { CUBE_BYTES, gradePixels, buildColourCube, DEFAULT_GRADING } from './grading.js';
describe('shared native LUT grading', () => {
  it('samples the g/b/r cube layout without modifying alpha or source', () => {
    const cube = new Float32Array(CUBE_BYTES);
    for (let g = 0; g < 32; g++) for (let b = 0; b < 32; b++) for (let r = 0; r < 32; r++) cube.set([r / 31 * 255, g / 31 * 255, b / 31 * 255, 255], (g * 1024 + b * 32 + r) * 4);
    const source = new Uint8ClampedArray([23, 99, 217, 127]);
    expect([...gradePixels(source, cube)]).toEqual([...source]);
    expect(() => gradePixels(source, new Float32Array(1))).toThrow();
  });
  it('rejects missing resources instead of silently showing the wrong environment', () => {
    expect(() => buildColourCube({ format: '', dimension: 32, cubes: {}, identity: 'identity', seasons: {}, insanity: {}, lunacy: { regular: '', full_moon: '', moon_storm: '' } }, new Map(), DEFAULT_GRADING)).toThrow();
  });
});
