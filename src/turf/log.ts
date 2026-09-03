import { NINE_SAMPLE_BIT_ORDER } from "./calibration.js";

export type TurfCalibrationObservation = {
  mask: number;
  bits: string;
  center: [number, number];
  atlasElement: null;
};

export type TurfCalibrationRun = {
  format: "dstjs-turf-calibration-run:v1";
  bitOrder: typeof NINE_SAMPLE_BIT_ORDER;
  observations: TurfCalibrationObservation[];
  missingMasks: number[];
  duplicateMasks: number[];
  rendererReportedComplete: boolean;
};

const MASK_MARKER = /\[DSTJS_TURF_CALIBRATION]\s+event=mask\s+mask=(\d{1,3})\s+bits=([01]{8})\s+center=(-?\d+),(-?\d+)/;
const COMPLETE_MARKER = /\[DSTJS_TURF_CALIBRATION]\s+event=complete\s+masks=256/;

export function parseTurfCalibrationLog(log: string): TurfCalibrationRun {
  const observations = new Map<number, TurfCalibrationObservation>();
  const duplicates = new Set<number>();
  let rendererReportedComplete = false;

  for (const line of log.split(/\r?\n/)) {
    if (COMPLETE_MARKER.test(line)) rendererReportedComplete = true;
    const match = MASK_MARKER.exec(line);
    if (!match) continue;
    const mask = Number(match[1]);
    const bits = match[2];
    const centerX = Number(match[3]);
    const centerY = Number(match[4]);
    if (mask > 255 || bits === undefined || centerX === undefined || centerY === undefined) continue;
    if (observations.has(mask)) duplicates.add(mask);
    observations.set(mask, { mask, bits, center: [centerX, centerY], atlasElement: null });
  }

  const missingMasks = Array.from({ length: 256 }, (_, mask) => mask)
    .filter((mask) => !observations.has(mask));
  return {
    format: "dstjs-turf-calibration-run:v1",
    bitOrder: NINE_SAMPLE_BIT_ORDER,
    observations: [...observations.values()].sort((left, right) => left.mask - right.mask),
    missingMasks,
    duplicateMasks: [...duplicates].sort((left, right) => left - right),
    rendererReportedComplete,
  };
}
