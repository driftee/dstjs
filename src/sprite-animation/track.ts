import type {
  SpriteAnimationClip,
  SpriteAnimationElement,
} from "./types.js";

const COST_EPSILON = 1e-9;

export type SpriteAnimationTrackSample = SpriteAnimationElement & {
  frame: number;
  drawOrder: number;
};

export type SpriteAnimationTrack = {
  id: string;
  layerId: string;
  layerName: string | null;
  samples: Array<SpriteAnimationTrackSample | null>;
};

export function trackSpriteAnimationClip(clip: SpriteAnimationClip): SpriteAnimationTrack[] {
  const tracks: SpriteAnimationTrack[] = [];
  let previousActive: Array<{ track: SpriteAnimationTrack; sample: SpriteAnimationTrackSample }> = [];

  for (const [frameIndex, frame] of clip.frames.entries()) {
    const current = frame.elements.map((element, drawOrder): SpriteAnimationTrackSample => ({
      ...element,
      frame: frameIndex,
      drawOrder,
    }));
    const previousByLayer = groupBy(previousActive, ({ track }) => track.layerId);
    const currentByLayer = groupBy(current, (sample) => sample.layerId);
    const nextActive: Array<{ track: SpriteAnimationTrack; sample: SpriteAnimationTrackSample }> = [];

    for (const layerId of new Set([...previousByLayer.keys(), ...currentByLayer.keys()])) {
      const previous = previousByLayer.get(layerId) ?? [];
      const candidates = currentByLayer.get(layerId) ?? [];
      const pairs = minimumCostPairs(
        previous.map(({ sample }) => sample),
        candidates,
      );
      const matchedCandidates = new Set<number>();
      for (const [previousIndex, candidateIndex] of pairs) {
        const active = previous[previousIndex];
        const sample = candidates[candidateIndex];
        if (!active || !sample) continue;
        active.track.samples[frameIndex] = sample;
        nextActive.push({ track: active.track, sample });
        matchedCandidates.add(candidateIndex);
      }
      for (const [candidateIndex, sample] of candidates.entries()) {
        if (matchedCandidates.has(candidateIndex)) continue;
        const track: SpriteAnimationTrack = {
          id: `track:${tracks.length}`,
          layerId: sample.layerId,
          layerName: sample.layerName,
          samples: Array.from({ length: clip.durationFrames }, () => null),
        };
        track.samples[frameIndex] = sample;
        tracks.push(track);
        nextActive.push({ track, sample });
      }
    }
    previousActive = nextActive;
  }

  return tracks;
}

function groupBy<T>(values: readonly T[], key: (value: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const value of values) {
    const groupKey = key(value);
    const group = groups.get(groupKey);
    if (group) group.push(value);
    else groups.set(groupKey, [value]);
  }
  return groups;
}

function minimumCostPairs(
  previous: readonly SpriteAnimationTrackSample[],
  current: readonly SpriteAnimationTrackSample[],
): Array<[previousIndex: number, currentIndex: number]> {
  if (previous.length === 0 || current.length === 0) return [];
  if (previous.length <= current.length) {
    return hungarian(previous.map((left) => current.map((right) => sampleCost(left, right))));
  }
  return hungarian(current.map((right) => previous.map((left) => sampleCost(left, right))))
    .map(([currentIndex, previousIndex]) => [previousIndex, currentIndex]);
}

function sampleCost(
  previous: SpriteAnimationTrackSample,
  current: SpriteAnimationTrackSample,
): number {
  const previousTransform = previous.transform.matrix;
  const currentTransform = current.transform.matrix;
  const dx = previousTransform[4] - currentTransform[4];
  const dy = previousTransform[5] - currentTransform[5];
  const linearDelta =
    square(previousTransform[0] - currentTransform[0])
    + square(previousTransform[1] - currentTransform[1])
    + square(previousTransform[2] - currentTransform[2])
    + square(previousTransform[3] - currentTransform[3]);
  const spritePenalty = semanticSpriteKey(previous) === semanticSpriteKey(current) ? 0 : 1_000;
  return square(dx) + square(dy)
    + linearDelta * 100
    + square(previous.z - current.z) * 0.01
    + spritePenalty;
}

function semanticSpriteKey(sample: SpriteAnimationTrackSample): string | number {
  const sourceSymbol = sample.metadata?.dstSymbolHash;
  return typeof sourceSymbol === "number" || typeof sourceSymbol === "string"
    ? sourceSymbol
    : sample.spriteId;
}

function square(value: number): number {
  return value * value;
}

/** Returns the minimum-cost assignment for a matrix with rows <= columns. */
function hungarian(costs: readonly (readonly number[])[]): Array<[row: number, column: number]> {
  const rowCount = costs.length;
  const columnCount = costs[0]?.length ?? 0;
  if (rowCount > columnCount) throw new Error("匈牙利算法要求行数不大于列数");
  const rowPotential = Array<number>(rowCount + 1).fill(0);
  const columnPotential = Array<number>(columnCount + 1).fill(0);
  const matchedRow = Array<number>(columnCount + 1).fill(0);
  const previousColumn = Array<number>(columnCount + 1).fill(0);

  for (let row = 1; row <= rowCount; row += 1) {
    matchedRow[0] = row;
    const minimum = Array<number>(columnCount + 1).fill(Infinity);
    const used = Array<boolean>(columnCount + 1).fill(false);
    let column = 0;
    do {
      used[column] = true;
      const activeRow = matchedRow[column] ?? 0;
      let delta = Infinity;
      let nextColumn = 0;
      for (let candidate = 1; candidate <= columnCount; candidate += 1) {
        if (used[candidate]) continue;
        const cost = costs[activeRow - 1]?.[candidate - 1];
        if (cost === undefined) throw new Error("匹配成本矩阵不完整");
        const reducedCost = cost - (rowPotential[activeRow] ?? 0) - (columnPotential[candidate] ?? 0);
        if (reducedCost < (minimum[candidate] ?? Infinity) - COST_EPSILON) {
          minimum[candidate] = reducedCost;
          previousColumn[candidate] = column;
        }
        const candidateMinimum = minimum[candidate] ?? Infinity;
        if (
          candidateMinimum < delta - COST_EPSILON
          || (Math.abs(candidateMinimum - delta) <= COST_EPSILON && candidate < nextColumn)
        ) {
          delta = candidateMinimum;
          nextColumn = candidate;
        }
      }
      for (let candidate = 0; candidate <= columnCount; candidate += 1) {
        if (used[candidate]) {
          const usedRow = matchedRow[candidate] ?? 0;
          rowPotential[usedRow] = (rowPotential[usedRow] ?? 0) + delta;
          columnPotential[candidate] = (columnPotential[candidate] ?? 0) - delta;
        } else {
          minimum[candidate] = (minimum[candidate] ?? Infinity) - delta;
        }
      }
      column = nextColumn;
    } while ((matchedRow[column] ?? 0) !== 0);

    do {
      const previous = previousColumn[column] ?? 0;
      matchedRow[column] = matchedRow[previous] ?? 0;
      column = previous;
    } while (column !== 0);
  }

  const pairs: Array<[number, number]> = [];
  for (let column = 1; column <= columnCount; column += 1) {
    const row = matchedRow[column] ?? 0;
    if (row > 0) pairs.push([row - 1, column - 1]);
  }
  return pairs.sort(([leftRow], [rightRow]) => leftRow - rightRow);
}
