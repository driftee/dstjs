export function zipWithEmptyFiles(filenames: readonly string[]): Buffer {
  return zipWithFiles(filenames.map((filename) => ({ filename, bytes: Buffer.alloc(0) })));
}

export function zipWithFiles(
  files: readonly { filename: string; bytes: Buffer }[],
): Buffer {
  const localFiles: Buffer[] = [];
  const centralEntries: Buffer[] = [];
  let localOffset = 0;

  for (const { filename, bytes } of files) {
    const name = Buffer.from(filename);
    const checksum = crc32(bytes);
    const localHeader = Buffer.alloc(30 + name.length);
    let offset = 0;
    localHeader.writeUInt32LE(0x04034b50, offset); offset += 4;
    localHeader.writeUInt16LE(20, offset); offset += 2;
    localHeader.writeUInt16LE(0, offset); offset += 2;
    localHeader.writeUInt16LE(0, offset); offset += 2;
    localHeader.writeUInt16LE(0, offset); offset += 2;
    localHeader.writeUInt16LE(0, offset); offset += 2;
    localHeader.writeUInt32LE(checksum, offset); offset += 4;
    localHeader.writeUInt32LE(bytes.length, offset); offset += 4;
    localHeader.writeUInt32LE(bytes.length, offset); offset += 4;
    localHeader.writeUInt16LE(name.length, offset); offset += 2;
    localHeader.writeUInt16LE(0, offset); offset += 2;
    name.copy(localHeader, offset);
    localFiles.push(localHeader, bytes);

    const centralEntry = Buffer.alloc(46 + name.length);
    offset = 0;
    centralEntry.writeUInt32LE(0x02014b50, offset); offset += 4;
    centralEntry.writeUInt16LE(20, offset); offset += 2;
    centralEntry.writeUInt16LE(20, offset); offset += 2;
    centralEntry.writeUInt16LE(0, offset); offset += 2;
    centralEntry.writeUInt16LE(0, offset); offset += 2;
    centralEntry.writeUInt16LE(0, offset); offset += 2;
    centralEntry.writeUInt16LE(0, offset); offset += 2;
    centralEntry.writeUInt32LE(checksum, offset); offset += 4;
    centralEntry.writeUInt32LE(bytes.length, offset); offset += 4;
    centralEntry.writeUInt32LE(bytes.length, offset); offset += 4;
    centralEntry.writeUInt16LE(name.length, offset); offset += 2;
    centralEntry.writeUInt16LE(0, offset); offset += 2;
    centralEntry.writeUInt16LE(0, offset); offset += 2;
    centralEntry.writeUInt16LE(0, offset); offset += 2;
    centralEntry.writeUInt16LE(0, offset); offset += 2;
    centralEntry.writeUInt32LE(0, offset); offset += 4;
    centralEntry.writeUInt32LE(localOffset, offset); offset += 4;
    name.copy(centralEntry, offset);
    centralEntries.push(centralEntry);
    localOffset += localHeader.length + bytes.length;
  }

  const centralDirectory = Buffer.concat(centralEntries);
  const end = Buffer.alloc(22);
  let offset = 0;
  end.writeUInt32LE(0x06054b50, offset); offset += 4;
  end.writeUInt16LE(0, offset); offset += 2;
  end.writeUInt16LE(0, offset); offset += 2;
  end.writeUInt16LE(files.length, offset); offset += 2;
  end.writeUInt16LE(files.length, offset); offset += 2;
  end.writeUInt32LE(centralDirectory.length, offset); offset += 4;
  end.writeUInt32LE(localOffset, offset); offset += 4;
  end.writeUInt16LE(0, offset);

  return Buffer.concat([...localFiles, centralDirectory, end]);
}

function crc32(input: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of input) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
