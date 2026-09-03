class TestBinaryWriter {
  private readonly chunks: Buffer[] = [];

  bytes(value: Buffer | string): this {
    this.chunks.push(typeof value === "string" ? Buffer.from(value, "ascii") : value);
    return this;
  }

  uint8(value: number): this {
    const chunk = Buffer.alloc(1);
    chunk.writeUInt8(value);
    this.chunks.push(chunk);
    return this;
  }

  uint32(value: number): this {
    const chunk = Buffer.alloc(4);
    chunk.writeUInt32LE(value);
    this.chunks.push(chunk);
    return this;
  }

  float32(value: number): this {
    const chunk = Buffer.alloc(4);
    chunk.writeFloatLE(value);
    this.chunks.push(chunk);
    return this;
  }

  string(value: string): this {
    const bytes = Buffer.from(value, "utf8");
    return this.uint32(bytes.length).bytes(bytes);
  }

  build(): Buffer {
    return Buffer.concat(this.chunks);
  }
}

export function createAnimationBinary(): Buffer {
  const writer = new TestBinaryWriter()
    .bytes("ANIM").uint32(4)
    .uint32(1).uint32(1).uint32(1).uint32(1)
    .string("idle").uint8(255).uint32(1).float32(10).uint32(1)
    .float32(0).float32(0).float32(2).float32(2)
    .uint32(1).uint32(2)
    .uint32(1)
    .uint32(3).uint32(0).uint32(4)
    .float32(1).float32(0).float32(0).float32(1)
    .float32(0).float32(0).float32(0)
    .uint32(4);
  for (const [hash, name] of [[1, "test_bank"], [2, "sound"], [3, "square"], [4, "square_layer"]] as const) {
    writer.uint32(hash).string(name);
  }
  return writer.build();
}

export function createBuildBinary(): Buffer {
  const writer = new TestBinaryWriter()
    .bytes("BILD").uint32(6)
    .uint32(1).uint32(1)
    .string("test_build")
    .uint32(1).string("atlas-0.tex")
    .uint32(3).uint32(1)
    .uint32(0).uint32(1)
    .float32(0).float32(0).float32(2).float32(2)
    .uint32(0).uint32(6)
    .uint32(6);
  const vertices = [
    [-1, -1, 0, 0, 0, 0],
    [1, -1, 0, 1, 0, 0],
    [1, 1, 0, 1, 1, 0],
    [-1, -1, 0, 0, 0, 0],
    [1, 1, 0, 1, 1, 0],
    [-1, 1, 0, 0, 1, 0],
  ];
  for (const vertex of vertices) {
    for (const value of vertex) writer.float32(value ?? 0);
  }
  return writer
    .uint32(1).uint32(3).string("square")
    .build();
}
