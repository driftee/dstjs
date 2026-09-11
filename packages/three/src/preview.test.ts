import { describe, expect, it } from 'vitest';
import { billboardMetrics, nativeCameraOffset } from './preview.js';
describe('shared preview calibration', () => {
  it('preserves ground origin and shares scale regardless of canvas bounds', () => {
    expect(billboardMetrics({ left: -80, top: -320, width: 160, height: 320 })).toEqual({ x: 0, y: 1, width: 1, height: 2 });
    expect(billboardMetrics({ left: -160, top: -160, width: 320, height: 160 }).width).toBe(2);
    expect(billboardMetrics({ left: -40, top: -160, width: 80, height: 160 }, 80, 40)).toEqual({ x: .5, y: 1, width: 1, height: 2 });
  });
  it('uses home simulator pitch and rejects invalid calibration', () => {
    expect(nativeCameraOffset(15).length()).toBeCloseTo(15);
    expect(nativeCameraOffset(15).y).toBeCloseTo(7.5);
    expect(() => nativeCameraOffset(NaN)).toThrow();
    expect(() => billboardMetrics({ left: 0, top: 0, width: 1, height: 1 }, 0)).toThrow();
  });
});
