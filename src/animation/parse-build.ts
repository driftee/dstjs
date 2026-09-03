import { openVersionedBinary, readHashTable } from "../binary/reader.js";
import type { BuildFile, BuildFrame, BuildSymbol, BuildVertex, Rectangle } from "./types.js";

const SUPPORTED_VERSIONS = new Set([5, 6]);
const MAX_COLLECTION_SIZE = 1_000_000;

export function parseBuild(input: Uint8Array): BuildFile {
  const { reader, version } = openVersionedBinary(input, "BILD", SUPPORTED_VERSIONS);
  const symbolCount = readCount(reader.readUint32(), "Build symbol");
  const expectedFrameCount = readCount(reader.readUint32(), "Build frame");
  const name = reader.readString();
  const atlasCount = readCount(reader.readUint32(), "Build atlas");
  if (atlasCount === 0) throw new Error("BILD 不包含 atlas");
  const atlases = Array.from({ length: atlasCount }, () => reader.readString());

  const symbols: BuildSymbol[] = [];
  for (let symbolIndex = 0; symbolIndex < symbolCount; symbolIndex += 1) {
    const hash = reader.readUint32();
    const frameCount = readCount(reader.readUint32(), "Symbol frame");
    const frames: BuildFrame[] = [];
    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
      frames.push({
        frameNumber: reader.readUint32(),
        duration: reader.readUint32(),
        bounds: readRectangle(reader),
        alphaIndex: reader.readUint32(),
        alphaCount: reader.readUint32(),
        vertices: [],
      });
    }
    symbols.push({ hash, name: null, frames });
  }

  const vertexCount = readCount(reader.readUint32(), "Build vertex");
  const vertices = Array.from({ length: vertexCount }, () => readVertex(reader));
  for (const symbol of symbols) {
    for (const frame of symbol.frames) {
      const end = frame.alphaIndex + frame.alphaCount;
      if (end > vertices.length) {
        throw new Error(`Symbol 0x${symbol.hash.toString(16)} 的顶点范围越界`);
      }
      frame.vertices = vertices.slice(frame.alphaIndex, end);
    }
  }

  const hashTable = version >= 6 ? readHashTable(reader) : new Map<number, string>();
  if (reader.remaining !== 0) throw new Error(`BILD 文件尾部仍有 ${reader.remaining} 字节未解析`);
  for (const symbol of symbols) symbol.name = hashTable.get(symbol.hash) ?? null;

  const actualFrameCount = symbols.reduce((sum, symbol) => sum + symbol.frames.length, 0);
  if (actualFrameCount !== expectedFrameCount) {
    throw new Error(`Build frame 总数不一致：文件头 ${expectedFrameCount}，实际 ${actualFrameCount}`);
  }

  return { version, name, atlases, symbols, vertices, hashTable };
}

function readRectangle(reader: ReturnType<typeof openVersionedBinary>["reader"]): Rectangle {
  return {
    x: reader.readFloat32(),
    y: reader.readFloat32(),
    width: reader.readFloat32(),
    height: reader.readFloat32(),
  };
}

function readVertex(reader: ReturnType<typeof openVersionedBinary>["reader"]): BuildVertex {
  return {
    x: reader.readFloat32(),
    y: reader.readFloat32(),
    z: reader.readFloat32(),
    u: reader.readFloat32(),
    v: reader.readFloat32(),
    w: reader.readFloat32(),
  };
}

function readCount(value: number, label: string): number {
  if (value > MAX_COLLECTION_SIZE) throw new Error(`${label} 数量 ${value} 超过限制`);
  return value;
}
