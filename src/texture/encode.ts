export type EncodeKtexRgbaOptions = {
  width: number;
  height: number;
  rgba: Uint8Array;
};

const KTEX_HEADER_SIZE = 8;
const MIPMAP_DESCRIPTOR_SIZE = 10;

/** Encode one uncompressed, premultiplied RGBA mipmap in the KTEX container. */
export function encodeKtexRgba(options: EncodeKtexRgbaOptions): Buffer {
  const { width, height, rgba } = options;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error(`KTEX 尺寸无效：${width}x${height}`);
  }
  if (width > 16_384 || height > 16_384) {
    throw new Error(`KTEX 尺寸超过限制：${width}x${height}`);
  }
  const dataSize = width * height * 4;
  if (rgba.length !== dataSize) {
    throw new Error(`RGBA 数据长度应为 ${dataSize}，实际为 ${rgba.length}`);
  }

  const output = Buffer.alloc(KTEX_HEADER_SIZE + MIPMAP_DESCRIPTOR_SIZE + dataSize);
  output.write("KTEX", 0, "ascii");
  output.writeUInt32LE(createHeader(), 4);
  output.writeUInt16LE(width, 8);
  output.writeUInt16LE(height, 10);
  output.writeUInt16LE(width * 4, 12);
  output.writeUInt32LE(dataSize, 14);

  const pixels = output.subarray(KTEX_HEADER_SIZE + MIPMAP_DESCRIPTOR_SIZE);
  for (let y = 0; y < height; y += 1) {
    const sourceRow = y * width * 4;
    const targetRow = (height - y - 1) * width * 4;
    for (let x = 0; x < width; x += 1) {
      const source = sourceRow + x * 4;
      const target = targetRow + x * 4;
      const alpha = rgba[source + 3] ?? 0;
      pixels[target] = premultiply(rgba[source] ?? 0, alpha);
      pixels[target + 1] = premultiply(rgba[source + 1] ?? 0, alpha);
      pixels[target + 2] = premultiply(rgba[source + 2] ?? 0, alpha);
      pixels[target + 3] = alpha;
    }
  }
  return output;
}

function createHeader(): number {
  const platform = 0;
  const compressionRgba = 4 << 4;
  const texture2d = 1 << 9;
  const mipmapCount = 1 << 13;
  const flags = 3 << 18;
  const fill = 0xfff << 20;
  return (platform | compressionRgba | texture2d | mipmapCount | flags | fill) >>> 0;
}

function premultiply(channel: number, alpha: number): number {
  return Math.round(channel * alpha / 255);
}
