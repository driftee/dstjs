import { openVersionedBinary, readHashTable } from "../binary/reader.js";
import type {
  Animation,
  AnimationElement,
  AnimationFile,
  AnimationFrame,
  Rectangle,
} from "./types.js";

const SUPPORTED_VERSIONS = new Set([3, 4]);
const MAX_COLLECTION_SIZE = 1_000_000;

export function parseAnimation(input: Uint8Array): AnimationFile {
  const { reader, version } = openVersionedBinary(input, "ANIM", SUPPORTED_VERSIONS);
  const expectedElements = readCount(reader.readUint32(), "动画元素");
  const expectedFrames = readCount(reader.readUint32(), "动画帧");
  const expectedEvents = readCount(reader.readUint32(), "动画事件");
  const animationCount = readCount(reader.readUint32(), "动画");

  const animations: Animation[] = [];
  for (let index = 0; index < animationCount; index += 1) {
    const name = reader.readString();
    const facing = reader.readUint8();
    const bankHash = reader.readUint32();
    const frameRate = reader.readFloat32();
    if (frameRate <= 0 || frameRate > 1_000) throw new Error(`动画 ${name} 的帧率无效：${frameRate}`);
    const frameCount = readCount(reader.readUint32(), `${name} 动画帧`);
    const frames: AnimationFrame[] = [];
    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
      const bounds = readRectangle(reader);
      const eventCount = readCount(reader.readUint32(), `${name} 动画事件`);
      const events = Array.from({ length: eventCount }, () => ({
        hash: reader.readUint32(),
        name: null,
      }));
      const elementCount = readCount(reader.readUint32(), `${name} 动画元素`);
      const elements = Array.from({ length: elementCount }, () => readElement(reader));
      frames.push({ bounds, events, elements });
    }
    animations.push({ name, facing, bankHash, bankName: null, frameRate, frames });
  }

  const hashTable = version >= 4 ? readHashTable(reader) : new Map<number, string>();
  if (reader.remaining !== 0) throw new Error(`ANIM 文件尾部仍有 ${reader.remaining} 字节未解析`);
  resolveAnimationNames(animations, hashTable);

  const actualFrames = animations.reduce((sum, animation) => sum + animation.frames.length, 0);
  const actualEvents = animations.reduce((sum, animation) =>
    sum + animation.frames.reduce((frameSum, frame) => frameSum + frame.events.length, 0), 0);
  const actualElements = animations.reduce((sum, animation) =>
    sum + animation.frames.reduce((frameSum, frame) => frameSum + frame.elements.length, 0), 0);
  assertCount("动画帧", expectedFrames, actualFrames);
  assertCount("动画事件", expectedEvents, actualEvents);
  assertCount("动画元素", expectedElements, actualElements);

  return { version, animations, hashTable };
}

function readRectangle(reader: ReturnType<typeof openVersionedBinary>["reader"]): Rectangle {
  return {
    x: reader.readFloat32(),
    y: reader.readFloat32(),
    width: reader.readFloat32(),
    height: reader.readFloat32(),
  };
}

function readElement(reader: ReturnType<typeof openVersionedBinary>["reader"]): AnimationElement {
  const symbolHash = reader.readUint32();
  const buildFrame = reader.readUint32();
  const layerHash = reader.readUint32();
  return {
    symbolHash,
    symbolName: null,
    buildFrame,
    layerHash,
    layerName: null,
    transform: {
      a: reader.readFloat32(),
      b: reader.readFloat32(),
      c: reader.readFloat32(),
      d: reader.readFloat32(),
      tx: reader.readFloat32(),
      ty: reader.readFloat32(),
    },
    z: reader.readFloat32(),
  };
}

function resolveAnimationNames(animations: Animation[], hashTable: ReadonlyMap<number, string>): void {
  for (const animation of animations) {
    animation.bankName = hashTable.get(animation.bankHash) ?? null;
    for (const frame of animation.frames) {
      for (const event of frame.events) event.name = hashTable.get(event.hash) ?? null;
      for (const element of frame.elements) {
        element.symbolName = hashTable.get(element.symbolHash) ?? null;
        element.layerName = hashTable.get(element.layerHash) ?? null;
      }
    }
  }
}

function readCount(value: number, label: string): number {
  if (value > MAX_COLLECTION_SIZE) throw new Error(`${label}数量 ${value} 超过限制`);
  return value;
}

function assertCount(label: string, expected: number, actual: number): void {
  if (expected !== actual) throw new Error(`${label}总数不一致：文件头 ${expected}，实际 ${actual}`);
}
