import sharp from "sharp";
import type { Metadata, Sharp } from "sharp";

export type PrunePadding = number | {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
};

export type PruneOutputFormat = "png" | "gif";

export type PruneTransparentImageOptions = {
  padding?: PrunePadding;
  alphaThreshold?: number;
  format?: PruneOutputFormat;
};

export type PruneRectangle = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type ResolvedPrunePadding = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

export type PrunedImage = {
  image: Buffer;
  width: number;
  height: number;
  inputWidth: number;
  inputHeight: number;
  pages: number;
  boundingBox: PruneRectangle | null;
  padding: ResolvedPrunePadding;
  pruned: boolean;
  format: PruneOutputFormat;
};

export async function pruneTransparentImage(
  input: Buffer | Uint8Array,
  options: PruneTransparentImageOptions = {},
): Promise<PrunedImage> {
  const source = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const metadata = await sharp(source, { animated: true }).metadata();
  if (!metadata.width || !metadata.height) throw new Error("无法读取图片尺寸");

  const rawImage = await sharp(source, { animated: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const inputWidth = rawImage.info.width;
  const pageHeight = metadata.pageHeight ?? rawImage.info.height;
  const pages = Math.max(1, metadata.pages ?? Math.floor(rawImage.info.height / pageHeight));
  const inputHeight = pageHeight;
  const padding = resolvePadding(options.padding);
  const alphaThreshold = resolveAlphaThreshold(options.alphaThreshold);
  const boundingBox = findAlphaBoundingBox(rawImage.data, inputWidth, inputHeight, pages, alphaThreshold);
  const format = options.format ?? (pages > 1 ? "gif" : "png");

  if (!boundingBox) {
    const image = await encodeImage(sharp(source, { animated: true }).ensureAlpha(), format, metadata);
    return {
      image,
      width: inputWidth,
      height: inputHeight,
      inputWidth,
      inputHeight,
      pages,
      boundingBox: null,
      padding,
      pruned: false,
      format,
    };
  }

  const outputWidth = boundingBox.width + padding.left + padding.right;
  const outputHeight = boundingBox.height + padding.top + padding.bottom;
  const pipeline = sharp(source, { animated: true })
    .ensureAlpha()
    .extract(boundingBox)
    .extend({
      top: padding.top,
      right: padding.right,
      bottom: padding.bottom,
      left: padding.left,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    });
  const image = await encodeImage(pipeline, format, metadata);

  return {
    image,
    width: outputWidth,
    height: outputHeight,
    inputWidth,
    inputHeight,
    pages,
    boundingBox,
    padding,
    pruned: outputWidth !== inputWidth || outputHeight !== inputHeight || boundingBox.left !== 0 || boundingBox.top !== 0,
    format,
  };
}

export function findAlphaBoundingBox(
  rgba: Buffer | Uint8Array,
  width: number,
  pageHeight: number,
  pages = 1,
  alphaThreshold = 0,
): PruneRectangle | null {
  if (!Number.isInteger(width) || width <= 0) throw new Error(`图片宽度无效：${width}`);
  if (!Number.isInteger(pageHeight) || pageHeight <= 0) throw new Error(`图片高度无效：${pageHeight}`);
  if (!Number.isInteger(pages) || pages <= 0) throw new Error(`图片帧数无效：${pages}`);
  const expectedLength = width * pageHeight * pages * 4;
  if (rgba.length < expectedLength) throw new Error("RGBA 像素数据不完整");

  let minX = width;
  let minY = pageHeight;
  let maxX = -1;
  let maxY = -1;

  for (let page = 0; page < pages; page += 1) {
    const pageOffset = page * width * pageHeight * 4;
    for (let y = 0; y < pageHeight; y += 1) {
      const rowOffset = pageOffset + y * width * 4;
      for (let x = 0; x < width; x += 1) {
        const alpha = rgba[rowOffset + x * 4 + 3] ?? 0;
        if (alpha <= alphaThreshold) continue;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < minX || maxY < minY) return null;
  return {
    left: minX,
    top: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

export function resolvePadding(padding: PrunePadding = 0): ResolvedPrunePadding {
  if (typeof padding === "number") {
    const value = requireNonNegativeInteger("padding", padding);
    return { top: value, right: value, bottom: value, left: value };
  }
  return {
    top: requireNonNegativeInteger("padding.top", padding.top ?? 0),
    right: requireNonNegativeInteger("padding.right", padding.right ?? 0),
    bottom: requireNonNegativeInteger("padding.bottom", padding.bottom ?? 0),
    left: requireNonNegativeInteger("padding.left", padding.left ?? 0),
  };
}

function resolveAlphaThreshold(value = 0): number {
  if (!Number.isInteger(value) || value < 0 || value > 255) {
    throw new Error(`透明阈值无效：${value}`);
  }
  return value;
}

function requireNonNegativeInteger(name: string, value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 16_384) {
    throw new Error(`${name} 必须是 0 到 16384 之间的整数`);
  }
  return value;
}

function encodeImage(
  image: Sharp,
  format: PruneOutputFormat,
  metadata: Metadata,
): Promise<Buffer> {
  if (format === "gif") {
    return image.gif({
      loop: metadata.loop,
      delay: metadata.delay,
    }).toBuffer();
  }
  return image.png({ compressionLevel: 9 }).toBuffer();
}
