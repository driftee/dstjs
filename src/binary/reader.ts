const textDecoder = new TextDecoder("utf-8", { fatal: true });

export class BinaryReader {
  private readonly view: DataView;
  private cursor: number;

  constructor(
    input: Uint8Array,
    readonly littleEndian: boolean,
    offset = 0,
  ) {
    this.view = new DataView(input.buffer, input.byteOffset, input.byteLength);
    this.cursor = offset;
  }

  get offset(): number {
    return this.cursor;
  }

  get remaining(): number {
    return this.view.byteLength - this.cursor;
  }

  readUint8(): number {
    this.ensureAvailable(1);
    const value = this.view.getUint8(this.cursor);
    this.cursor += 1;
    return value;
  }

  readUint32(): number {
    this.ensureAvailable(4);
    const value = this.view.getUint32(this.cursor, this.littleEndian);
    this.cursor += 4;
    return value;
  }

  readFloat32(): number {
    this.ensureAvailable(4);
    const value = this.view.getFloat32(this.cursor, this.littleEndian);
    this.cursor += 4;
    if (!Number.isFinite(value)) throw new Error(`偏移 ${this.cursor - 4} 处包含无效浮点数`);
    return value;
  }

  readString(maximumBytes = 1024 * 1024): string {
    const length = this.readUint32();
    if (length > maximumBytes) throw new Error(`字符串长度 ${length} 超过 ${maximumBytes} 字节限制`);
    this.ensureAvailable(length);
    const bytes = new Uint8Array(
      this.view.buffer,
      this.view.byteOffset + this.cursor,
      length,
    );
    this.cursor += length;
    return textDecoder.decode(bytes);
  }

  private ensureAvailable(length: number): void {
    if (length < 0 || this.cursor + length > this.view.byteLength) {
      throw new Error(`二进制数据在偏移 ${this.cursor} 处意外结束，需要 ${length} 字节`);
    }
  }
}

export function openVersionedBinary(
  input: Uint8Array,
  expectedMagic: string,
  supportedVersions: ReadonlySet<number>,
): { reader: BinaryReader; version: number } {
  if (input.byteLength < 8) throw new Error(`${expectedMagic} 文件头不完整`);
  const magic = new TextDecoder("ascii").decode(input.subarray(0, 4));
  if (magic !== expectedMagic) throw new Error(`文件标识应为 ${expectedMagic}，实际为 ${magic}`);

  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const littleVersion = view.getUint32(4, true);
  const bigVersion = view.getUint32(4, false);
  const littleEndian = supportedVersions.has(littleVersion)
    ? true
    : supportedVersions.has(bigVersion)
      ? false
      : null;
  if (littleEndian === null) {
    throw new Error(`${expectedMagic} 版本不受支持：LE=${littleVersion}，BE=${bigVersion}`);
  }
  return {
    reader: new BinaryReader(input, littleEndian, 8),
    version: littleEndian ? littleVersion : bigVersion,
  };
}

export function readHashTable(reader: BinaryReader, maximumEntries = 1_000_000): Map<number, string> {
  if (reader.remaining === 0) return new Map();
  const count = reader.readUint32();
  if (count > maximumEntries) throw new Error(`哈希表条目数 ${count} 超过限制`);

  const result = new Map<number, string>();
  for (let index = 0; index < count; index += 1) {
    const hash = reader.readUint32();
    const name = reader.readString();
    if (result.has(hash)) throw new Error(`哈希表包含重复哈希 0x${hash.toString(16)}`);
    result.set(hash, name);
  }
  return result;
}
