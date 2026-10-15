import type { BuildFile } from "./types.js";

/** Full BILD inventory, not the subset referenced by one animation. */
export function buildManifest(build: BuildFile) {
  return {
    format: "dstjs-build-manifest:v1",
    name: build.name,
    version: build.version,
    atlases: build.atlases,
    symbolCount: build.symbols.length,
    frameCount: build.symbols.reduce((sum, symbol) => sum + symbol.frames.length, 0),
    symbols: build.symbols.map((symbol) => ({
      name: symbol.name,
      hash: symbol.hash,
      frames: symbol.frames.map((frame) => ({
        frameNumber: frame.frameNumber,
        duration: frame.duration,
        bounds: frame.bounds,
        // BILD bounds store the center and size in symbol-local space.
        originX: frame.bounds.width / 2 - frame.bounds.x,
        originY: frame.bounds.height / 2 - frame.bounds.y,
        atlasIndices: [...new Set(frame.vertices.map((vertex) => vertex.w))],
      })),
    })),
  };
}
