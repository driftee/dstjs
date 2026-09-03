import sharp from "sharp";

import type { DecodedKtex } from "../texture/ktex.js";
import type { BuildFrame } from "../animation/types.js";

type Point = { x: number; y: number };

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
  const top = frame.bounds.y + frame.bounds.height / 2;
  const width = Math.max(1, Math.ceil(frame.bounds.width + padding * 2));
  const height = Math.max(1, Math.ceil(frame.bounds.height + padding * 2));
  const atlasSources = await Promise.all(atlases.map(async (atlas) => {
    const png = await sharp(Buffer.from(atlas.rgba), {
      raw: { width: atlas.width, height: atlas.height, channels: 4 },
    }).png().toBuffer();
    return `data:image/png;base64,${png.toString("base64")}`;
  }));

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
    const source = atlasSources[atlasIndex];
    if (!atlas || !source) throw new Error(`Build frame 使用了不存在的 atlas ${atlasIndex}`);

    const sourcePoints = vertices.map((vertex) => ({
      x: vertex.u * atlas.width,
      y: (1 - vertex.v) * atlas.height,
    }));
    const destinationPoints = vertices.map((vertex) => ({
      x: vertex.x - left + padding,
      y: top - vertex.y + padding,
    }));
    const matrix = affineBetweenTriangles(sourcePoints, destinationPoints);
    if (!matrix) continue;
    const clipId = `triangle-${index / 3}`;
    triangles.push([
      `<clipPath id="${clipId}" clipPathUnits="userSpaceOnUse">`,
      `<polygon points="${destinationPoints.map((point) => `${point.x},${point.y}`).join(" ")}"/>`,
      "</clipPath>",
      `<g clip-path="url(#${clipId})">`,
      `<image href="${source}" width="${atlas.width}" height="${atlas.height}"`,
      ` transform="matrix(${matrix.join(" ")})"/>`,
      "</g>",
    ].join(""));
  }
  if (triangles.length === 0) throw new Error("Build frame 没有可渲染的三角形");

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    ...triangles,
    "</svg>",
  ].join("");
  return {
    png: await sharp(Buffer.from(svg)).png().toBuffer(),
    width,
    height,
    originX: -left + padding,
    originY: top + padding,
  };
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
