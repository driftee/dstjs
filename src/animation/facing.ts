const MIRRORED_EIGHT_FACING_BITS = new Set([
  1 << 2, // FACING_LEFT
  1 << 5, // FACING_UPLEFT
  1 << 7, // FACING_DOWNLEFT
]);

/** Whether SetEightFaced mirrors this shared facing animation horizontally. */
export function isMirroredEightFacingBit(facingBit: number): boolean {
  return MIRRORED_EIGHT_FACING_BITS.has(facingBit);
}
