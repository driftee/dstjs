import type { TurfRecognitionReport } from "./recognition.js";

export const TURF_DIRECTION_LAYOUT = [
  { name: "N", bit: 0, screenOffset: [1, 0] },
  { name: "NE", bit: 1, screenOffset: [1, 1] },
  { name: "E", bit: 2, screenOffset: [0, 1] },
  { name: "SE", bit: 3, screenOffset: [-1, 1] },
  { name: "S", bit: 4, screenOffset: [-1, 0] },
  { name: "SW", bit: 5, screenOffset: [-1, -1] },
  { name: "W", bit: 6, screenOffset: [0, -1] },
  { name: "NW", bit: 7, screenOffset: [1, -1] },
] as const;

export type TurfDirectionName = typeof TURF_DIRECTION_LAYOUT[number]["name"];

export type TurfEdgeMapping = {
  format: "dstjs-turf-edge-mapping:v1";
  bitOrder: TurfDirectionName[];
  stateBits: ["counterClockwise", "center", "clockwise"];
  centerElement: number;
  directions: Array<{
    name: TurfDirectionName;
    bit: number;
    screenOffset: [number, number];
    elements: [number, number, number, number, number, number, number, number];
  }>;
  validation: {
    masks: number;
    comparisons: number;
    conflicts: 0;
  };
};

export function deriveTurfEdgeMapping(report: TurfRecognitionReport): TurfEdgeMapping {
  if (report.observations.length !== 256) {
    throw new Error(`需要完整的 256 组 mask，实际为 ${report.observations.length} 组`);
  }

  const centerElements = new Set(report.observations.map((observation) =>
    requireCellElement(observation.cells, 0, 0, observation.mask)));
  if (centerElements.size !== 1) {
    throw new Error(`中心 element 不唯一：${[...centerElements].join(", ")}`);
  }

  let comparisons = 0;
  const directions = TURF_DIRECTION_LAYOUT.map((direction) => {
    const states = Array.from({ length: 8 }, () => new Set<number>());
    for (const observation of report.observations) {
      const state = turfEdgeState(observation.mask, direction.bit);
      const [offsetX, offsetY] = direction.screenOffset;
      states[state]?.add(requireCellElement(observation.cells, offsetX, offsetY, observation.mask));
      comparisons += 1;
    }
    const elements = states.map((values, state) => {
      if (values.size !== 1) {
        throw new Error(`${direction.name} 的局部状态 ${state} 对应多个 element：${[...values].join(", ")}`);
      }
      const element = [...values][0];
      if (element === undefined) throw new Error(`${direction.name} 缺少局部状态 ${state}`);
      return element;
    }) as TurfEdgeMapping["directions"][number]["elements"];
    return {
      name: direction.name,
      bit: direction.bit,
      screenOffset: [...direction.screenOffset] as [number, number],
      elements,
    };
  });

  return {
    format: "dstjs-turf-edge-mapping:v1",
    bitOrder: TURF_DIRECTION_LAYOUT.map((direction) => direction.name),
    stateBits: ["counterClockwise", "center", "clockwise"],
    centerElement: [...centerElements][0] ?? 1,
    directions,
    validation: { masks: report.observations.length, comparisons, conflicts: 0 },
  };
}

export function turfEdgeState(mask: number, directionBit: number): number {
  if (!Number.isInteger(mask) || mask < 0 || mask > 255) throw new Error(`mask 超出范围：${mask}`);
  if (!Number.isInteger(directionBit) || directionBit < 0 || directionBit > 7) {
    throw new Error(`方向 bit 超出范围：${directionBit}`);
  }
  const counterClockwiseBit = (directionBit + 7) % 8;
  const clockwiseBit = (directionBit + 1) % 8;
  return ((mask >> counterClockwiseBit) & 1)
    | (((mask >> directionBit) & 1) << 1)
    | (((mask >> clockwiseBit) & 1) << 2);
}

export function lookupTurfEdgeElement(
  mapping: TurfEdgeMapping,
  direction: TurfDirectionName | number,
  mask: number,
): number {
  const entry = typeof direction === "number"
    ? mapping.directions.find((candidate) => candidate.bit === direction)
    : mapping.directions.find((candidate) => candidate.name === direction);
  if (!entry) throw new Error(`未知方向：${direction}`);
  const element = entry.elements[turfEdgeState(mask, entry.bit)];
  if (element === undefined) throw new Error(`方向 ${entry.name} 缺少局部状态`);
  return element;
}

function requireCellElement(
  cells: TurfRecognitionReport["observations"][number]["cells"],
  offsetX: number,
  offsetY: number,
  mask: number,
): number {
  const cell = cells.find((candidate) => candidate.offset[0] === offsetX && candidate.offset[1] === offsetY);
  if (!cell) throw new Error(`mask ${mask} 缺少单元格 ${offsetX},${offsetY}`);
  return cell.element;
}
