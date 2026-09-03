import sharp from "sharp";

import { decodeKtex, type KtexCompression } from "./ktex.js";

export type ConvertedKtexPng = {
  png: Buffer;
  width: number;
  height: number;
  compression: KtexCompression;
  mipmapCount: number;
};

export async function convertKtexToPng(input: Uint8Array): Promise<ConvertedKtexPng> {
  const decoded = decodeKtex(input);
  const png = await sharp(decoded.rgba, {
    raw: {
      width: decoded.width,
      height: decoded.height,
      channels: 4,
    },
  }).png().toBuffer();
  return {
    png,
    width: decoded.width,
    height: decoded.height,
    compression: decoded.compression,
    mipmapCount: decoded.mipmapCount,
  };
}
