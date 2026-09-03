import { readdir } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

import { NINE_SAMPLE_BIT_ORDER } from "./calibration.js";

const ANALYSIS_WIDTH = 864;
const ATLAS_CELL_UNITS = 64;
const MARKER_TO_CELL_CENTER_UNITS = 28;
const BARCODE_THRESHOLD = 0.1;
const DIGIT_THRESHOLD = 0.25;
const MARKER_THRESHOLD = 0.22;
const SEVEN_SEGMENT_MASKS = [
  0b0111111,
  0b0000110,
  0b1011011,
  0b1001111,
  0b1100110,
  0b1101101,
  0b1111101,
  0b0000111,
  0b1111111,
  0b1101111,
] as const;

type RgbImage = {
  data: Buffer;
  width: number;
  height: number;
};

export type TurfRecognitionCell = {
  offset: [number, number];
  element: number;
  barcodeElement: number;
  digitElement: number | null;
  confidence: number;
  consistent: boolean;
};

export type TurfRecognitionReport = {
  format: "dstjs-turf-recognition:v1";
  geometry: {
    analysisSize: [number, number];
    step: number;
    targetMarker: [number, number];
  };
  observations: Array<{
    mask: number;
    file: string;
    cells: TurfRecognitionCell[];
  }>;
  cellSummaries: Array<{
    offset: [number, number];
    observations: number;
    uniqueElements: number[];
    bitSensitivity: number[];
  }>;
  inconsistentCells: number;
  lowConfidenceCells: number;
};

export type TurfNativeLookupReport = {
  format: "dstjs-turf-native-lookup:v1";
  bitOrder: typeof NINE_SAMPLE_BIT_ORDER;
  geometry: TurfRecognitionReport["geometry"];
  elements: number[];
  observations: Array<{
    mask: number;
    file: string;
    element: number;
    barcodeElement: number | null;
    digitElement: number | null;
    confidence: number;
    consistent: boolean;
  }>;
  inconsistentMasks: number[];
  lowConfidenceMasks: number[];
};

export async function recognizeTurfCaptures(directory: string): Promise<TurfRecognitionReport> {
  const inputDirectory = path.resolve(directory);
  const files = (await readdir(inputDirectory))
    .filter((file) => /^mask-\d{3}\.png$/.test(file))
    .sort();
  if (files.length === 0) throw new Error(`目录中没有 mask-XXX.png：${inputDirectory}`);

  const firstImage = await loadAnalysisImage(path.join(inputDirectory, files[0] ?? ""));
  const geometry = detectGeometry(firstImage);
  const observations = await mapConcurrent(files, 8, async (file) => {
    const mask = Number(file.slice(5, 8));
    const image = await loadAnalysisImage(path.join(inputDirectory, file));
    return { mask, file, cells: recognizeCells(image, geometry) };
  });
  observations.sort((left, right) => left.mask - right.mask);

  const cellSummaries = summarizeCells(observations);
  const allCells = observations.flatMap((observation) => observation.cells);
  return {
    format: "dstjs-turf-recognition:v1",
    geometry: {
      analysisSize: [firstImage.width, firstImage.height],
      step: geometry.step,
      targetMarker: [geometry.targetX, geometry.targetY],
    },
    observations,
    cellSummaries,
    inconsistentCells: allCells.filter((cell) => !cell.consistent).length,
    lowConfidenceCells: allCells.filter((cell) => cell.confidence < 0.5).length,
  };
}

export async function recognizeTurfNativeLookup(directory: string): Promise<TurfNativeLookupReport> {
  const inputDirectory = path.resolve(directory);
  const files = (await readdir(inputDirectory))
    .filter((file) => /^mask-\d{3}\.png$/.test(file))
    .sort();
  if (files.length !== 256) throw new Error(`需要完整的 256 张截图，实际为 ${files.length} 张`);

  let referenceImage: RgbImage | null = null;
  let geometry: { step: number; targetX: number; targetY: number } | null = null;
  for (const file of [...files].reverse()) {
    const image = await loadAnalysisImage(path.join(inputDirectory, file));
    try {
      const candidate = detectGeometry(image);
      if (sampleRatio(image, candidate.targetX + 5, candidate.targetY + 5, 5, 5) < MARKER_THRESHOLD) continue;
      referenceImage = image;
      geometry = candidate;
      break;
    } catch {
      // Sparse masks may not contain enough labels to establish the grid.
    }
  }
  if (!referenceImage || !geometry) throw new Error("没有找到包含中心标记的参考帧");

  const observations = await mapConcurrent(files, 8, async (file) => {
    const mask = Number(file.slice(5, 8));
    const image = await loadAnalysisImage(path.join(inputDirectory, file));
    const markerRatio = sampleRatio(image, geometry.targetX + 5, geometry.targetY + 5, 5, 5);
    if (markerRatio < MARKER_THRESHOLD) {
      if (mask !== 0) throw new Error(`mask ${mask} 的中心没有校准标记`);
      return {
        mask,
        file,
        element: 0,
        barcodeElement: null,
        digitElement: null,
        confidence: 1,
        consistent: true,
      };
    }
    const barcode = decodeBarcode(image, geometry.targetX, geometry.targetY, geometry.step);
    if (barcode.element < 1 || barcode.element > 48) {
      throw new Error(`mask ${mask} 的中心条码超出范围：${barcode.element}`);
    }
    const digits = decodeDigits(image, geometry.targetX, geometry.targetY, geometry.step);
    const digitElement = digits.confidence >= 0.5 && digits.tens !== null && digits.ones !== null
      ? digits.tens * 10 + digits.ones
      : null;
    const consistent = digitElement === null || digitElement === barcode.element;
    return {
      mask,
      file,
      element: barcode.element,
      barcodeElement: barcode.element,
      digitElement,
      confidence: round(barcode.confidence * (consistent ? 1 : 0.5)),
      consistent,
    };
  });
  observations.sort((left, right) => left.mask - right.mask);
  return {
    format: "dstjs-turf-native-lookup:v1",
    bitOrder: NINE_SAMPLE_BIT_ORDER,
    geometry: {
      analysisSize: [referenceImage.width, referenceImage.height],
      step: geometry.step,
      targetMarker: [geometry.targetX, geometry.targetY],
    },
    elements: observations.map((observation) => observation.element),
    observations,
    inconsistentMasks: observations.filter((observation) => !observation.consistent).map((observation) => observation.mask),
    lowConfidenceMasks: observations.filter((observation) => observation.confidence < 0.5).map((observation) => observation.mask),
  };
}

export function decodeSevenSegmentMask(mask: number): number | null {
  const digit = SEVEN_SEGMENT_MASKS.indexOf(mask as typeof SEVEN_SEGMENT_MASKS[number]);
  return digit >= 0 ? digit : null;
}

async function loadAnalysisImage(file: string): Promise<RgbImage> {
  const { data, info } = await sharp(file)
    .resize({ width: ANALYSIS_WIDTH })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

function detectGeometry(image: RgbImage): { step: number; targetX: number; targetY: number } {
  const markers = findMarkerComponents(image);
  if (markers.length < 6) throw new Error(`方向标记不足，无法建立采样网格：${markers.length}`);
  const step = median([
    ...axisSteps(markers.map((marker) => marker.x)),
    ...axisSteps(markers.map((marker) => marker.y)),
  ]);
  if (!Number.isFinite(step) || step < 100 || step > 180) {
    throw new Error(`采样网格间距异常：${step}`);
  }
  const expectedX = image.width / 2 - step * MARKER_TO_CELL_CENTER_UNITS / ATLAS_CELL_UNITS;
  const expectedY = image.height / 2 - step * MARKER_TO_CELL_CENTER_UNITS / ATLAS_CELL_UNITS;
  return {
    step,
    targetX: nearest(markers.map((marker) => marker.x), expectedX),
    targetY: nearest(markers.map((marker) => marker.y), expectedY),
  };
}

function findMarkerComponents(image: RgbImage): Array<{ x: number; y: number }> {
  const pixels = image.width * image.height;
  const mask = new Uint8Array(pixels);
  const visited = new Uint8Array(pixels);
  for (let index = 0; index < pixels; index += 1) mask[index] = isPink(image, index % image.width, Math.floor(index / image.width)) ? 1 : 0;
  const markers: Array<{ x: number; y: number }> = [];
  for (let start = 0; start < pixels; start += 1) {
    if (mask[start] !== 1 || visited[start] === 1) continue;
    const stack = [start];
    visited[start] = 1;
    let area = 0;
    let minX = image.width;
    let minY = image.height;
    let maxX = 0;
    let maxY = 0;
    while (stack.length > 0) {
      const current = stack.pop();
      if (current === undefined) break;
      const x = current % image.width;
      const y = Math.floor(current / image.width);
      area += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      for (const neighbour of [current - 1, current + 1, current - image.width, current + image.width]) {
        if (neighbour < 0 || neighbour >= pixels || visited[neighbour] === 1 || mask[neighbour] !== 1) continue;
        if (Math.abs(neighbour % image.width - x) > 1) continue;
        visited[neighbour] = 1;
        stack.push(neighbour);
      }
    }
    const width = maxX - minX + 1;
    const height = maxY - minY + 1;
    if (area >= 35 && area <= 90 && width >= 8 && width <= 12 && height >= 8 && height <= 12) {
      markers.push({ x: minX, y: minY });
    }
  }
  return markers;
}

function recognizeCells(
  image: RgbImage,
  geometry: { step: number; targetX: number; targetY: number },
): TurfRecognitionCell[] {
  const cells: TurfRecognitionCell[] = [];
  for (let offsetY = -3; offsetY <= 3; offsetY += 1) {
    for (let offsetX = -4; offsetX <= 4; offsetX += 1) {
      const markerX = geometry.targetX + offsetX * geometry.step;
      const markerY = geometry.targetY + offsetY * geometry.step;
      if (markerX < 0 || markerY < 0 || markerX + geometry.step > image.width || markerY + geometry.step > image.height) continue;
      if (sampleRatio(image, markerX + 5, markerY + 5, 5, 5) < MARKER_THRESHOLD) continue;
      const barcode = decodeBarcode(image, markerX, markerY, geometry.step);
      if (barcode.element < 1 || barcode.element > 48) continue;
      const digits = decodeDigits(image, markerX, markerY, geometry.step);
      const digitElement = digits.confidence >= 0.5 && digits.tens !== null && digits.ones !== null
        ? digits.tens * 10 + digits.ones
        : null;
      const consistent = digitElement === null || digitElement === barcode.element;
      cells.push({
        offset: [offsetX, offsetY],
        element: barcode.element,
        barcodeElement: barcode.element,
        digitElement,
        confidence: round(barcode.confidence * (consistent ? 1 : 0.5)),
        consistent,
      });
    }
  }
  return cells;
}

function decodeBarcode(image: RgbImage, markerX: number, markerY: number, step: number): { element: number; confidence: number } {
  let element = 0;
  const confidences: number[] = [];
  for (let bit = 0; bit < 6; bit += 1) {
    const x = markerX + step * (5 + 9 * bit) / ATLAS_CELL_UNITS;
    const y = markerY + step * 48.5 / ATLAS_CELL_UNITS;
    const ratio = sampleRatio(image, x, y, 4, 5);
    if (ratio > BARCODE_THRESHOLD) element |= 1 << bit;
    confidences.push(thresholdConfidence(ratio));
  }
  return { element, confidence: Math.min(...confidences) };
}

function decodeDigits(
  image: RgbImage,
  markerX: number,
  markerY: number,
  step: number,
): { tens: number | null; ones: number | null; confidence: number } {
  const tens = decodeDigit(image, markerX, markerY, step, 9);
  const ones = decodeDigit(image, markerX, markerY, step, 34);
  return { tens: tens.digit, ones: ones.digit, confidence: Math.min(tens.confidence, ones.confidence) };
}

function decodeDigit(
  image: RgbImage,
  markerX: number,
  markerY: number,
  step: number,
  digitOffsetX: number,
): { digit: number | null; confidence: number } {
  const points = [
    [digitOffsetX + 9, 7],
    [digitOffsetX + 17, 14],
    [digitOffsetX + 17, 28],
    [digitOffsetX + 9, 35],
    [digitOffsetX + 1, 28],
    [digitOffsetX + 1, 14],
    [digitOffsetX + 9, 21],
  ];
  let mask = 0;
  const confidences: number[] = [];
  for (const [unitX, unitY] of points) {
    const ratio = sampleRatio(
      image,
      markerX + step * (unitX ?? 0) / ATLAS_CELL_UNITS,
      markerY + step * (unitY ?? 0) / ATLAS_CELL_UNITS,
      2,
      2,
    );
    if (ratio > DIGIT_THRESHOLD) mask |= 1 << confidences.length;
    confidences.push(Math.min(1, Math.abs(ratio - DIGIT_THRESHOLD) / 0.15));
  }
  return { digit: decodeSevenSegmentMask(mask), confidence: Math.min(...confidences) };
}

function summarizeCells(observations: TurfRecognitionReport["observations"]): TurfRecognitionReport["cellSummaries"] {
  const offsets = new Set(observations.flatMap((observation) => observation.cells.map((cell) => cell.offset.join(","))));
  return [...offsets].map((key) => {
    const [offsetX = 0, offsetY = 0] = key.split(",").map(Number);
    const values = new Map(observations.map((observation) => [
      observation.mask,
      observation.cells.find((cell) => cell.offset[0] === offsetX && cell.offset[1] === offsetY)?.element ?? null,
    ]));
    const present = [...values.values()].filter((value): value is number => value !== null);
    const bitSensitivity = Array.from({ length: 8 }, (_, bit) => {
      let changed = 0;
      let pairs = 0;
      for (let mask = 0; mask < 256; mask += 1) {
        const other = mask ^ (1 << bit);
        if (other < mask || !values.has(mask) || !values.has(other)) continue;
        pairs += 1;
        if (values.get(mask) !== values.get(other)) changed += 1;
      }
      return round(pairs === 0 ? 0 : changed / pairs);
    });
    return {
      offset: [offsetX, offsetY] as [number, number],
      observations: present.length,
      uniqueElements: [...new Set(present)].sort((left, right) => left - right),
      bitSensitivity,
    };
  }).sort((left, right) =>
    right.bitSensitivity.reduce((sum, value) => sum + value, 0)
    - left.bitSensitivity.reduce((sum, value) => sum + value, 0));
}

function isPink(image: RgbImage, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return false;
  const offset = (Math.floor(y) * image.width + Math.floor(x)) * 3;
  const red = image.data[offset] ?? 0;
  const green = image.data[offset + 1] ?? 0;
  const blue = image.data[offset + 2] ?? 0;
  return red > 140 && blue > 90 && red > green * 1.8 && blue > green * 1.3;
}

function sampleRatio(image: RgbImage, centerX: number, centerY: number, radiusX: number, radiusY: number): number {
  let pink = 0;
  let total = 0;
  for (let y = Math.round(centerY) - radiusY; y <= Math.round(centerY) + radiusY; y += 1) {
    for (let x = Math.round(centerX) - radiusX; x <= Math.round(centerX) + radiusX; x += 1) {
      total += 1;
      if (isPink(image, x, y)) pink += 1;
    }
  }
  return total === 0 ? 0 : pink / total;
}

function axisSteps(values: number[]): number[] {
  const unique = [...new Set(values)].sort((left, right) => left - right);
  const differences = unique.slice(1).map((value, index) => value - (unique[index] ?? value));
  return differences.filter((difference) => difference >= 100 && difference <= 180);
}

function nearest(values: number[], expected: number): number {
  const sorted = [...new Set(values)].sort((left, right) => Math.abs(left - expected) - Math.abs(right - expected));
  const value = sorted[0];
  if (value === undefined) throw new Error("没有可用的方向标记");
  return value;
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const value = sorted[middle];
  if (value === undefined) return Number.NaN;
  return sorted.length % 2 === 0 ? (value + (sorted[middle - 1] ?? value)) / 2 : value;
}

function thresholdConfidence(ratio: number): number {
  return Math.min(1, Math.abs(ratio - BARCODE_THRESHOLD) / BARCODE_THRESHOLD);
}

function round(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

async function mapConcurrent<T, R>(values: T[], concurrency: number, mapper: (value: T) => Promise<R>): Promise<R[]> {
  const output = new Array<R>(values.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      const value = values[index];
      if (value !== undefined) output[index] = await mapper(value);
    }
  });
  await Promise.all(workers);
  return output;
}
