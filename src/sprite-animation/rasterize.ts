import sharp from "sharp";

import type { DecodedKtex } from "../texture/ktex.js";
import type { BuildFrame, BuildVertex } from "../animation/types.js";

type Point = { x: number; y: number };
type AxisAlignedQuad = {
  atlas: DecodedKtex;
  sourceLeft: number;
  sourceTop: number;
  destinationLeft: number;
  destinationTop: number;
  width: number;
  height: number;
  flipX: boolean;
  flipY: boolean;
};
const atlasPngCache = new WeakMap<DecodedKtex, Promise<Buffer>>();

export type RasterizedBuildFrame = {
  png: Buffer;
  width: number;
  height: number;
  originX: number;
  originY: number;
};

export async function rasterizeBuildFrame(
  frame: BuildFrame,
  atlases: readonly DecodedKtex[],
  padding = 1,
): Promise<RasterizedBuildFrame> {
  if (frame.vertices.length === 0 || frame.vertices.length % 3 !== 0) {
    throw new Error("Build frame 的顶点必须是非空三角形列表");
  }
  const left = frame.bounds.x - frame.bounds.width / 2;
  const top = frame.bounds.y - frame.bounds.height / 2;
  const width = Math.max(1, Math.ceil(frame.bounds.width + padding * 2));
  const height = Math.max(1, Math.ceil(frame.bounds.height + padding * 2));
  const quads = axisAlignedQuads(frame, atlases, left, top, padding, width, height);
  if (quads) {
    const rgba = composeAxisAlignedQuads(quads, width, height);
    return {
      png: await sharp(rgba, {
        raw: { width, height, channels: 4 },
      }).png().toBuffer(),
      width,
      height,
      originX: -left + padding,
      originY: -top + padding,
    };
  }
  const atlasSources = new Map<number, {
    id: string;
    source: string;
    width: number;
    height: number;
  }>();
  const triangles: string[] = [];
  for (let index = 0; index < frame.vertices.length; index += 3) {
    const vertices = frame.vertices.slice(index, index + 3);
    const first = vertices[0];
    if (!first || vertices.length !== 3) throw new Error("Build frame 的三角形不完整");
    const atlasIndex = Math.round(first.w);
    if (!vertices.every((vertex) => Math.round(vertex.w) === atlasIndex)) {
      throw new Error("Build frame 的单个三角形跨越多个 atlas");
    }
    const atlas = atlases[atlasIndex];
    if (!atlas) throw new Error(`Build frame 使用了不存在的 atlas ${atlasIndex}`);
    let atlasSource = atlasSources.get(atlasIndex);
    if (!atlasSource) {
      let pngPromise = atlasPngCache.get(atlas);
      if (!pngPromise) {
        pngPromise = sharp(Buffer.from(atlas.rgba), {
          raw: { width: atlas.width, height: atlas.height, channels: 4 },
        }).png().toBuffer();
        atlasPngCache.set(atlas, pngPromise);
      }
      const png = await pngPromise;
      atlasSource = {
        id: `atlas-${atlasIndex}`,
        source: `data:image/png;base64,${png.toString("base64")}`,
        width: atlas.width,
        height: atlas.height,
      };
      atlasSources.set(atlasIndex, atlasSource);
    }

    const sourcePoints = vertices.map((vertex) => ({
      x: vertex.u * atlas.width,
      y: (1 - vertex.v) * atlas.height,
    }));
    const destinationPoints = vertices.map((vertex) => ({
      x: vertex.x - left + padding,
      y: vertex.y - top + padding,
    }));
    const matrix = affineBetweenTriangles(sourcePoints, destinationPoints);
    if (!matrix) continue;
    const clipId = `triangle-${index / 3}`;
    triangles.push([
      `<clipPath id="${clipId}" clipPathUnits="userSpaceOnUse">`,
      `<polygon points="${destinationPoints.map((point) => `${point.x},${point.y}`).join(" ")}"/>`,
      "</clipPath>",
      `<g clip-path="url(#${clipId})">`,
      `<use href="#${atlasSource.id}" transform="matrix(${matrix.join(" ")})"/>`,
      "</g>",
    ].join(""));
  }
  if (triangles.length === 0) throw new Error("Build frame 没有可渲染的三角形");

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    "<defs>",
    ...[...atlasSources.values()].map((source) =>
      `<image id="${source.id}" href="${source.source}" width="${source.width}" height="${source.height}"/>`),
    "</defs>",
    ...triangles,
    "</svg>",
  ].join("");
  return {
    png: await sharp(Buffer.from(svg)).png().toBuffer(),
    width,
    height,
    originX: -left + padding,
    originY: -top + padding,
  };
}

function axisAlignedQuads(
  frame: BuildFrame,
  atlases: readonly DecodedKtex[],
  frameLeft: number,
  frameTop: number,
  padding: number,
  outputWidth: number,
  outputHeight: number,
): AxisAlignedQuad[] | null {
  if (frame.vertices.length % 6 !== 0) return null;
  const quads: AxisAlignedQuad[] = [];
  for (let index = 0; index < frame.vertices.length; index += 6) {
    const vertices = frame.vertices.slice(index, index + 6);
    const first = vertices[0];
    if (!first || vertices.length !== 6) return null;
    const atlasIndex = Math.round(first.w);
    if (!vertices.every((vertex) => Math.round(vertex.w) === atlasIndex)) return null;
    const atlas = atlases[atlasIndex];
    if (!atlas) return null;
    const source = vertices.map((vertex) => ({
      x: vertex.u * atlas.width,
      y: (1 - vertex.v) * atlas.height,
    }));
    const sourceBounds = pointBounds(source);
    const destinationBounds = pointBounds(vertices);
    if (
      !rectangleCorners(source, sourceBounds)
      || !rectangleCorners(vertices, destinationBounds)
      || !formsRectangleTriangles(source, sourceBounds)
      || !formsRectangleTriangles(vertices, destinationBounds)
    ) {
      return null;
    }
    const sourceWidth = roundedSpan(sourceBounds.left, sourceBounds.right);
    const sourceHeight = roundedSpan(sourceBounds.top, sourceBounds.bottom);
    const destinationWidth = roundedSpan(destinationBounds.left, destinationBounds.right);
    const destinationHeight = roundedSpan(destinationBounds.top, destinationBounds.bottom);
    if (
      sourceWidth === null
      || sourceHeight === null
      || destinationWidth !== sourceWidth
      || destinationHeight !== sourceHeight
    ) {
      return null;
    }
    const sourceLeft = roundedCoordinate(sourceBounds.left);
    const sourceTop = roundedCoordinate(sourceBounds.top);
    const destinationLeft = roundedCoordinate(destinationBounds.left - frameLeft + padding);
    const destinationTop = roundedCoordinate(destinationBounds.top - frameTop + padding);
    if (
      sourceLeft === null
      || sourceTop === null
      || destinationLeft === null
      || destinationTop === null
      || sourceLeft < 0
      || sourceTop < 0
      || sourceLeft + sourceWidth > atlas.width
      || sourceTop + sourceHeight > atlas.height
      || destinationLeft < 0
      || destinationTop < 0
      || destinationLeft + destinationWidth > outputWidth
      || destinationTop + destinationHeight > outputHeight
    ) {
      return null;
    }
    const sourceLeftDestination = mappedAxisCoordinate(
      vertices,
      source,
      sourceBounds.left,
      "x",
    );
    const sourceRightDestination = mappedAxisCoordinate(
      vertices,
      source,
      sourceBounds.right,
      "x",
    );
    const sourceTopDestination = mappedAxisCoordinate(
      vertices,
      source,
      sourceBounds.top,
      "y",
    );
    const sourceBottomDestination = mappedAxisCoordinate(
      vertices,
      source,
      sourceBounds.bottom,
      "y",
    );
    if (
      sourceLeftDestination === null
      || sourceRightDestination === null
      || sourceTopDestination === null
      || sourceBottomDestination === null
      || !vertices.every((vertex, vertexIndex) =>
        nearlyEqual(
          vertex.x,
          nearlyEqual(source[vertexIndex]!.x, sourceBounds.left)
            ? sourceLeftDestination
            : sourceRightDestination,
        )
        && nearlyEqual(
          vertex.y,
          nearlyEqual(source[vertexIndex]!.y, sourceBounds.top)
            ? sourceTopDestination
            : sourceBottomDestination,
        ))
    ) {
      return null;
    }
    quads.push({
      atlas,
      sourceLeft,
      sourceTop,
      destinationLeft,
      destinationTop,
      width: sourceWidth,
      height: sourceHeight,
      flipX: sourceLeftDestination > sourceRightDestination,
      flipY: sourceTopDestination > sourceBottomDestination,
    });
  }
  return quads;
}

function composeAxisAlignedQuads(
  quads: readonly AxisAlignedQuad[],
  width: number,
  height: number,
): Buffer {
  const output = Buffer.alloc(width * height * 4);
  for (const quad of quads) {
    for (let y = 0; y < quad.height; y += 1) {
      const sourceY = quad.sourceTop + (quad.flipY ? quad.height - y - 1 : y);
      const destinationY = quad.destinationTop + y;
      for (let x = 0; x < quad.width; x += 1) {
        const sourceX = quad.sourceLeft + (quad.flipX ? quad.width - x - 1 : x);
        const sourceOffset = (sourceY * quad.atlas.width + sourceX) * 4;
        const sourceAlpha = quad.atlas.rgba[sourceOffset + 3] ?? 0;
        if (sourceAlpha === 0) continue;
        const destinationOffset = (destinationY * width + quad.destinationLeft + x) * 4;
        if (sourceAlpha === 255 || output[destinationOffset + 3] === 0) {
          output[destinationOffset] = quad.atlas.rgba[sourceOffset] ?? 0;
          output[destinationOffset + 1] = quad.atlas.rgba[sourceOffset + 1] ?? 0;
          output[destinationOffset + 2] = quad.atlas.rgba[sourceOffset + 2] ?? 0;
          output[destinationOffset + 3] = sourceAlpha;
          continue;
        }
        blendPixel(output, destinationOffset, quad.atlas.rgba, sourceOffset);
      }
    }
  }
  return output;
}

function blendPixel(
  destination: Buffer,
  destinationOffset: number,
  source: Uint8Array,
  sourceOffset: number,
): void {
  const sourceAlpha = (source[sourceOffset + 3] ?? 0) / 255;
  const destinationAlpha = (destination[destinationOffset + 3] ?? 0) / 255;
  const outputAlpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha);
  if (outputAlpha <= 0) return;
  for (let channel = 0; channel < 3; channel += 1) {
    const sourceValue = source[sourceOffset + channel] ?? 0;
    const destinationValue = destination[destinationOffset + channel] ?? 0;
    destination[destinationOffset + channel] = Math.round(
      (sourceValue * sourceAlpha
        + destinationValue * destinationAlpha * (1 - sourceAlpha))
      / outputAlpha,
    );
  }
  destination[destinationOffset + 3] = Math.round(outputAlpha * 255);
}

function pointBounds(points: readonly Pick<BuildVertex, "x" | "y">[]): {
  left: number;
  right: number;
  top: number;
  bottom: number;
} {
  return {
    left: Math.min(...points.map((point) => point.x)),
    right: Math.max(...points.map((point) => point.x)),
    top: Math.min(...points.map((point) => point.y)),
    bottom: Math.max(...points.map((point) => point.y)),
  };
}

function rectangleCorners(
  points: readonly Pick<BuildVertex, "x" | "y">[],
  bounds: ReturnType<typeof pointBounds>,
): boolean {
  return points.every((point) =>
    (nearlyEqual(point.x, bounds.left) || nearlyEqual(point.x, bounds.right))
    && (nearlyEqual(point.y, bounds.top) || nearlyEqual(point.y, bounds.bottom)));
}

function formsRectangleTriangles(
  points: readonly Pick<BuildVertex, "x" | "y">[],
  bounds: ReturnType<typeof pointBounds>,
): boolean {
  if (points.length !== 6) return false;
  const corner = (point: Pick<BuildVertex, "x" | "y">): string => [
    nearlyEqual(point.x, bounds.left) ? "left" : "right",
    nearlyEqual(point.y, bounds.top) ? "top" : "bottom",
  ].join(":");
  const firstTriangle = new Set(points.slice(0, 3).map(corner));
  const secondTriangle = new Set(points.slice(3, 6).map(corner));
  const allCorners = new Set([...firstTriangle, ...secondTriangle]);
  const sharedCorners = [...firstTriangle].filter(value => secondTriangle.has(value));
  return firstTriangle.size === 3
    && secondTriangle.size === 3
    && allCorners.size === 4
    && sharedCorners.length === 2;
}

function mappedAxisCoordinate(
  destination: readonly BuildVertex[],
  source: readonly Point[],
  sourceCoordinate: number,
  axis: "x" | "y",
): number | null {
  const values = source.flatMap((point, index) =>
    nearlyEqual(point[axis], sourceCoordinate) ? [destination[index]![axis]] : []);
  const first = values[0];
  return first !== undefined && values.every((value) => nearlyEqual(value, first))
    ? first
    : null;
}

function roundedSpan(start: number, end: number): number | null {
  const rounded = Math.round(end - start);
  return rounded > 0 && nearlyEqual(end - start, rounded) ? rounded : null;
}

function roundedCoordinate(value: number): number | null {
  const rounded = Math.round(value);
  return nearlyEqual(value, rounded) ? rounded : null;
}

function nearlyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) < 1e-3;
}

function affineBetweenTriangles(source: Point[], destination: Point[]): number[] | null {
  const [source0, source1, source2] = source;
  const [destination0, destination1, destination2] = destination;
  if (!source0 || !source1 || !source2 || !destination0 || !destination1 || !destination2) return null;
  const source10X = source1.x - source0.x;
  const source10Y = source1.y - source0.y;
  const source20X = source2.x - source0.x;
  const source20Y = source2.y - source0.y;
  const determinant = source10X * source20Y - source20X * source10Y;
  if (Math.abs(determinant) < 1e-8) return null;

  const destination10X = destination1.x - destination0.x;
  const destination10Y = destination1.y - destination0.y;
  const destination20X = destination2.x - destination0.x;
  const destination20Y = destination2.y - destination0.y;
  const a = (destination10X * source20Y - destination20X * source10Y) / determinant;
  const c = (source10X * destination20X - source20X * destination10X) / determinant;
  const b = (destination10Y * source20Y - destination20Y * source10Y) / determinant;
  const d = (source10X * destination20Y - source20X * destination10Y) / determinant;
  const e = destination0.x - a * source0.x - c * source0.y;
  const f = destination0.y - b * source0.x - d * source0.y;
  return [a, b, c, d, e, f];
}
