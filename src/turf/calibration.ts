import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

import { encodeKtexRgba } from "../texture/encode.js";

export const NINE_SAMPLE_BIT_ORDER = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;

export type CalibrationAssets = {
  atlasKtex: Buffer;
  atlasPng: Buffer;
  atlasXml: string;
  noiseKtex: Buffer;
  noisePng: Buffer;
};

const ATLAS_SIZE = 512;
const COLUMNS = 8;
const ROWS = 6;
const CELL_SIZE = 64;
const CELL_MARGIN = 2;
const ELEMENT_SIZE = CELL_SIZE - CELL_MARGIN * 2;
const DIGIT_WIDTH = 18;
const DIGIT_HEIGHT = 30;
const DIGIT_STROKE = 3;
const DIGIT_SEGMENT_MASKS = [
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

export async function createTurfCalibrationAssets(): Promise<CalibrationAssets> {
  // Ground-atlas UVs invert each element vertically in game. Keep the PNG
  // human-readable while compensating only the KTEX payload for that mapping.
  const atlasRgba = createAtlasPixels(true);
  const atlasPreviewRgba = createAtlasPixels(false);
  const noiseRgba = createNoisePixels(64, 64);
  return {
    atlasKtex: encodeKtexRgba({ width: ATLAS_SIZE, height: ATLAS_SIZE, rgba: atlasRgba }),
    atlasPng: await rawToPng(atlasPreviewRgba, ATLAS_SIZE, ATLAS_SIZE, true),
    atlasXml: createAtlasXml(),
    noiseKtex: encodeKtexRgba({ width: 64, height: 64, rgba: noiseRgba }),
    noisePng: await rawToPng(noiseRgba, 64, 64),
  };
}

export async function writeTurfCalibrationAssets(outputDirectory: string): Promise<void> {
  const assets = await createTurfCalibrationAssets();
  const tilesDirectory = path.join(outputDirectory, "levels", "tiles");
  const texturesDirectory = path.join(outputDirectory, "levels", "textures");
  const previewDirectory = path.join(outputDirectory, "preview");
  await Promise.all([
    mkdir(tilesDirectory, { recursive: true }),
    mkdir(texturesDirectory, { recursive: true }),
    mkdir(previewDirectory, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(path.join(tilesDirectory, "dstjs_calibration.tex"), assets.atlasKtex),
    writeFile(path.join(tilesDirectory, "dstjs_calibration.xml"), assets.atlasXml, "utf8"),
    writeFile(path.join(texturesDirectory, "dstjs_calibration_noise.tex"), assets.noiseKtex),
    writeFile(path.join(previewDirectory, "dstjs_calibration_atlas.png"), assets.atlasPng),
    writeFile(path.join(previewDirectory, "dstjs_calibration_noise.png"), assets.noisePng),
  ]);
}

function createAtlasPixels(flipElementY: boolean): Uint8Array {
  const rgba = new Uint8Array(ATLAS_SIZE * ATLAS_SIZE * 4);
  for (let element = 1; element <= 48; element += 1) {
    const column = (element - 1) % COLUMNS;
    const row = Math.floor((element - 1) / COLUMNS);
    const left = column * CELL_SIZE + CELL_MARGIN;
    const top = row * CELL_SIZE + CELL_MARGIN;
    for (let y = 0; y < ELEMENT_SIZE; y += 1) {
      for (let x = 0; x < ELEMENT_SIZE; x += 1) {
        const markY = flipElementY ? ELEMENT_SIZE - y - 1 : y;
        const alpha = isCalibrationMark(element, x, markY) ? 255 : 0;
        const offset = ((top + y) * ATLAS_SIZE + left + x) * 4;
        rgba[offset] = 255;
        rgba[offset + 1] = 255;
        rgba[offset + 2] = 255;
        rgba[offset + 3] = alpha;
      }
    }
  }
  return rgba;
}

function isCalibrationMark(element: number, x: number, y: number): boolean {
  const directionMarker = x >= 2 && x <= 6 && y >= 2 && y <= 6 && (x <= 3 || y <= 3);
  const tens = Math.floor(element / 10);
  const ones = element % 10;
  const number = isSevenSegmentPixel(tens, x - 9, y - 7)
    || isSevenSegmentPixel(ones, x - 33, y - 7);
  const barcodeBit = Math.floor((x - 4) / 9);
  const barcode = y >= 46
    && y <= 55
    && barcodeBit >= 0
    && barcodeBit < 6
    && (x - 4) % 9 <= 6
    && ((element >> barcodeBit) & 1) === 1;
  return directionMarker || number || barcode;
}

function isSevenSegmentPixel(digit: number, x: number, y: number): boolean {
  if (x < 0 || x >= DIGIT_WIDTH || y < 0 || y >= DIGIT_HEIGHT) return false;
  const mask = DIGIT_SEGMENT_MASKS[digit] ?? 0;
  const horizontal = x >= DIGIT_STROKE && x < DIGIT_WIDTH - DIGIT_STROKE;
  const upperVertical = y >= DIGIT_STROKE && y < Math.floor(DIGIT_HEIGHT / 2) - 1;
  const lowerVertical = y > Math.floor(DIGIT_HEIGHT / 2) && y < DIGIT_HEIGHT - DIGIT_STROKE;
  const segments = [
    horizontal && y < DIGIT_STROKE,
    x >= DIGIT_WIDTH - DIGIT_STROKE && upperVertical,
    x >= DIGIT_WIDTH - DIGIT_STROKE && lowerVertical,
    horizontal && y >= DIGIT_HEIGHT - DIGIT_STROKE,
    x < DIGIT_STROKE && lowerVertical,
    x < DIGIT_STROKE && upperVertical,
    horizontal && y >= Math.floor(DIGIT_HEIGHT / 2) - 1 && y <= Math.floor(DIGIT_HEIGHT / 2) + 1,
  ];
  return segments.some((active, index) => active && ((mask >> index) & 1) === 1);
}

function createNoisePixels(width: number, height: number): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  for (let offset = 0; offset < rgba.length; offset += 4) {
    rgba[offset] = 255;
    rgba[offset + 1] = 32;
    rgba[offset + 2] = 208;
    rgba[offset + 3] = 255;
  }
  return rgba;
}

function createAtlasXml(): string {
  const elements = Array.from({ length: COLUMNS * ROWS }, (_, index) => {
    const column = index % COLUMNS;
    const row = Math.floor(index / COLUMNS);
    const left = column * CELL_SIZE + CELL_MARGIN;
    const right = left + ELEMENT_SIZE;
    const top = row * CELL_SIZE + CELL_MARGIN;
    const bottom = top + ELEMENT_SIZE;
    const u1 = left / ATLAS_SIZE;
    const u2 = right / ATLAS_SIZE;
    const v1 = (ATLAS_SIZE - bottom) / ATLAS_SIZE;
    const v2 = (ATLAS_SIZE - top) / ATLAS_SIZE;
    const name = String(index + 1).padStart(2, "0");
    return `<Element name="${name}" u1="${u1}" u2="${u2}" v1="${v1}" v2="${v2}" variant="" />`;
  }).join("");
  return `<Atlas><Texture filename="data/levels/tiles/dstjs_calibration.tex" /><Elements>${elements}</Elements></Atlas>\n`;
}

function rawToPng(rgba: Uint8Array, width: number, height: number, darkBackground = false): Promise<Buffer> {
  const image = sharp(rgba, { raw: { width, height, channels: 4 } });
  return (darkBackground ? image.flatten({ background: "#17141f" }) : image).png().toBuffer();
}
