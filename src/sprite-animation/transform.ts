import type {
  SpriteAnimationMatrix,
  SpriteAnimationTransform,
  SpriteAnimationTransformChannels,
} from "./types.js";

const DECOMPOSITION_EPSILON = 1e-10;
const RADIANS_PER_DEGREE = Math.PI / 180;
const DEGREES_PER_RADIAN = 180 / Math.PI;

export function composeSpriteAnimationTransform(
  channels: SpriteAnimationTransformChannels,
): SpriteAnimationMatrix {
  assertFiniteChannels(channels);
  const [tx, ty] = channels.position;
  const [scaleX, scaleY] = channels.scale;
  const rotation = channels.rotation * RADIANS_PER_DEGREE;
  const skewX = channels.skewX * RADIANS_PER_DEGREE;
  const cosine = Math.cos(rotation);
  const sine = Math.sin(rotation);
  const tangent = Math.tan(skewX);
  return [
    cleanNumber(cosine * scaleX),
    cleanNumber(sine * scaleX),
    cleanNumber(scaleY * (cosine * tangent - sine)),
    cleanNumber(scaleY * (sine * tangent + cosine)),
    tx,
    ty,
  ];
}

export function decomposeSpriteAnimationTransform(
  matrix: SpriteAnimationMatrix,
): SpriteAnimationTransformChannels {
  assertFiniteMatrix(matrix);
  const [a, b, c, d, tx, ty] = matrix;
  const scaleX = Math.hypot(a, b);
  if (scaleX > DECOMPOSITION_EPSILON) {
    const scaleY = (a * d - b * c) / scaleX;
    const shearProjection = (a * c + b * d) / scaleX;
    return {
      position: [tx, ty],
      rotation: cleanNumber(Math.atan2(b, a) * DEGREES_PER_RADIAN),
      scale: [cleanNumber(scaleX), cleanNumber(scaleY)],
      skewX: Math.abs(scaleY) > DECOMPOSITION_EPSILON
        ? cleanNumber(Math.atan(shearProjection / scaleY) * DEGREES_PER_RADIAN)
        : 0,
    };
  }

  const scaleY = Math.hypot(c, d);
  if (scaleY > DECOMPOSITION_EPSILON) {
    return {
      position: [tx, ty],
      rotation: cleanNumber(Math.atan2(-c, d) * DEGREES_PER_RADIAN),
      scale: [0, cleanNumber(scaleY)],
      skewX: 0,
    };
  }

  return {
    position: [tx, ty],
    rotation: 0,
    scale: [0, 0],
    skewX: 0,
  };
}

export function createSpriteAnimationTransform(
  matrix: SpriteAnimationMatrix,
): SpriteAnimationTransform {
  return {
    matrix: [...matrix],
    channels: decomposeSpriteAnimationTransform(matrix),
  };
}

export function withSpriteAnimationTransformChannels(
  transform: SpriteAnimationTransform,
  updates: Partial<SpriteAnimationTransformChannels>,
): SpriteAnimationTransform {
  const channels: SpriteAnimationTransformChannels = {
    position: updates.position ?? transform.channels.position,
    rotation: updates.rotation ?? transform.channels.rotation,
    scale: updates.scale ?? transform.channels.scale,
    skewX: updates.skewX ?? transform.channels.skewX,
  };
  return {
    matrix: composeSpriteAnimationTransform(channels),
    channels,
  };
}

export function spriteAnimationTransformChannelsAreExact(
  transform: SpriteAnimationTransform,
  tolerance = 1e-8,
): boolean {
  if (!Number.isFinite(tolerance) || tolerance < 0) {
    throw new Error(`Sprite Animation 变换误差阈值无效：${tolerance}`);
  }
  const recomposed = composeSpriteAnimationTransform(transform.channels);
  return recomposed.every((value, index) =>
    Math.abs(value - (transform.matrix[index] ?? Number.NaN)) <= tolerance);
}

function assertFiniteMatrix(matrix: SpriteAnimationMatrix): void {
  if (!matrix.every(Number.isFinite)) {
    throw new Error("Sprite Animation 变换矩阵包含非有限数值");
  }
}

function assertFiniteChannels(channels: SpriteAnimationTransformChannels): void {
  const values = [
    ...channels.position,
    channels.rotation,
    ...channels.scale,
    channels.skewX,
  ];
  if (!values.every(Number.isFinite)) {
    throw new Error("Sprite Animation 变换通道包含非有限数值");
  }
}

function cleanNumber(value: number): number {
  return Math.abs(value) <= DECOMPOSITION_EPSILON ? 0 : value;
}
