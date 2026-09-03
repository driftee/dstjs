import decodeDxt from "decode-dxt";

export type KtexCompression = "dxt1" | "dxt3" | "dxt5" | "rgba" | "rgb";

export type DecodedKtex = {
  width: number;
  height: number;
  rgba: Uint8Array;
  compression: KtexCompression;
  mipmapCount: number;
};

type Mipmap = {
  width: number;
  height: number;
  pitch: number;
  data: Buffer;
};

const compressionNames = new Map<number, KtexCompression>([
  [0, "dxt1"],
  [1, "dxt3"],
  [2, "dxt5"],
  [4, "rgba"],
  [5, "rgb"],
]);

const MAX_DIMENSION = 16_384;
const MAX_DECODED_BYTES = 512 * 1024 * 1024;

export type KtexDecodeOptions = {
  /** Default true for sprite/UI PNGs. Ground shaders sample stored RGB directly
   * and multiply by alpha themselves; use false for those texture assets. */
  unpremultiplyAlpha?: boolean;
};

export function decodeKtex(input: Uint8Array, options: KtexDecodeOptions = {}): DecodedKtex {
  const source = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (source.length < 18 || source.subarray(0, 4).toString("ascii") !== "KTEX") {
    throw new Error("输入不是有效的 KTEX 文件");
  }

  const littleHeader = source.readUInt32LE(4);
  const bigHeader = source.readUInt32BE(4);
  const littleFill = (littleHeader >>> 20) & 0xfff;
  const bigFill = (bigHeader >>> 20) & 0xfff;
  const littleEndian = littleFill === 0xfff || bigFill !== 0xfff;
  const header = littleEndian ? littleHeader : bigHeader;
  const compressionCode = (header >>> 4) & 0x1f;
  const compression = compressionNames.get(compressionCode);
  if (!compression) throw new Error(`暂不支持 KTEX 压缩格式 ${compressionCode}`);

  const mipmapCount = (header >>> 13) & 0x1f;
  if (mipmapCount < 1) throw new Error("KTEX 不包含 mipmap");
  const metadataEnd = 8 + mipmapCount * 10;
  if (metadataEnd > source.length) throw new Error("KTEX mipmap 元数据不完整");

  const descriptors: Array<Omit<Mipmap, "data"> & { dataSize: number }> = [];
  let cursor = 8;
  for (let index = 0; index < mipmapCount; index += 1) {
    const width = readUInt16(source, cursor, littleEndian);
    const height = readUInt16(source, cursor + 2, littleEndian);
    const pitch = readUInt16(source, cursor + 4, littleEndian);
    const dataSize = readUInt32(source, cursor + 6, littleEndian);
    validateDimensions(width, height);
    descriptors.push({ width, height, pitch, dataSize });
    cursor += 10;
  }

  const mipmaps: Mipmap[] = [];
  cursor = metadataEnd;
  for (const descriptor of descriptors) {
    const end = cursor + descriptor.dataSize;
    if (end > source.length) throw new Error("KTEX mipmap 像素数据不完整");
    mipmaps.push({ ...descriptor, data: source.subarray(cursor, end) });
    cursor = end;
  }

  const firstMipmap = mipmaps[0];
  if (!firstMipmap) throw new Error("KTEX 不包含 mipmap");
  const mipmap = mipmaps.reduce((largest, current) =>
    current.width * current.height > largest.width * largest.height ? current : largest, firstMipmap);
  let rgba = decodePixels(mipmap, compression);
  if (options.unpremultiplyAlpha !== false) demultiplyAlpha(rgba);
  rgba = flipVertically(rgba, mipmap.width, mipmap.height);

  return {
    width: mipmap.width,
    height: mipmap.height,
    rgba,
    compression,
    mipmapCount,
  };
}

function decodePixels(mipmap: Mipmap, compression: KtexCompression): Uint8Array {
  if (compression === "dxt1" || compression === "dxt3" || compression === "dxt5") {
    const view = new DataView(mipmap.data.buffer, mipmap.data.byteOffset, mipmap.data.byteLength);
    return decodeDxt(view, mipmap.width, mipmap.height, compression);
  }

  const channels = compression === "rgba" ? 4 : 3;
  const minimumPitch = mipmap.width * channels;
  const pitch = Math.max(minimumPitch, mipmap.pitch);
  if (mipmap.data.length < pitch * mipmap.height) {
    throw new Error("KTEX 未压缩像素数据不完整");
  }

  const rgba = new Uint8Array(mipmap.width * mipmap.height * 4);
  for (let y = 0; y < mipmap.height; y += 1) {
    for (let x = 0; x < mipmap.width; x += 1) {
      const sourceOffset = y * pitch + x * channels;
      const targetOffset = (y * mipmap.width + x) * 4;
      rgba[targetOffset] = mipmap.data[sourceOffset] ?? 0;
      rgba[targetOffset + 1] = mipmap.data[sourceOffset + 1] ?? 0;
      rgba[targetOffset + 2] = mipmap.data[sourceOffset + 2] ?? 0;
      rgba[targetOffset + 3] = channels === 4 ? (mipmap.data[sourceOffset + 3] ?? 0) : 255;
    }
  }
  return rgba;
}

function demultiplyAlpha(rgba: Uint8Array): void {
  for (let offset = 0; offset < rgba.length; offset += 4) {
    const alpha = rgba[offset + 3] ?? 0;
    if (alpha === 0 || alpha === 255) continue;
    rgba[offset] = Math.min(255, Math.round((rgba[offset] ?? 0) * 255 / alpha));
    rgba[offset + 1] = Math.min(255, Math.round((rgba[offset + 1] ?? 0) * 255 / alpha));
    rgba[offset + 2] = Math.min(255, Math.round((rgba[offset + 2] ?? 0) * 255 / alpha));
  }
}

function flipVertically(rgba: Uint8Array, width: number, height: number): Uint8Array {
  const rowSize = width * 4;
  const result = new Uint8Array(rgba.length);
  for (let y = 0; y < height; y += 1) {
    result.set(rgba.subarray(y * rowSize, (y + 1) * rowSize), (height - y - 1) * rowSize);
  }
  return result;
}

function validateDimensions(width: number, height: number): void {
  if (width < 1 || height < 1 || width > MAX_DIMENSION || height > MAX_DIMENSION) {
    throw new Error(`KTEX 尺寸无效：${width}x${height}`);
  }
  if (width * height * 4 > MAX_DECODED_BYTES) {
    throw new Error(`KTEX 解码后超过 ${MAX_DECODED_BYTES / 1024 / 1024} MiB 限制`);
  }
}

function readUInt16(input: Buffer, offset: number, littleEndian: boolean): number {
  return littleEndian ? input.readUInt16LE(offset) : input.readUInt16BE(offset);
}

function readUInt32(input: Buffer, offset: number, littleEndian: boolean): number {
  return littleEndian ? input.readUInt32LE(offset) : input.readUInt32BE(offset);
}
