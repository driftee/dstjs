export function createKtex(input: {
  compression: number;
  width: number;
  height: number;
  pitch: number;
  pixels: Buffer;
  declaredSize?: number;
}): Buffer {
  const header =
    (input.compression << 4)
    | (1 << 9)
    | (1 << 13)
    | (3 << 18)
    | (0xfff << 20);
  const result = Buffer.alloc(18 + input.pixels.length);
  result.write("KTEX", 0, "ascii");
  result.writeUInt32LE(header >>> 0, 4);
  result.writeUInt16LE(input.width, 8);
  result.writeUInt16LE(input.height, 10);
  result.writeUInt16LE(input.pitch, 12);
  result.writeUInt32LE(input.declaredSize ?? input.pixels.length, 14);
  input.pixels.copy(result, 18);
  return result;
}
