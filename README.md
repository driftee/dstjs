# DST.js

A TypeScript toolkit for parsing, extracting, converting, and rendering
Don't Starve Together assets.

> [!IMPORTANT]
> DST.js is an independent, unofficial project. It is not affiliated with or
> endorsed by Klei Entertainment. Don't Starve and Don't Starve Together are
> trademarks of Klei Entertainment.

The repository is currently private and under active development. The first
working baseline is migrated from the production-tested `ktools-node` package
used by QiNeko Wiki.

## Current capabilities

- Decode KTEX textures using DXT1, DXT3, DXT5, RGB, or RGBA compression.
- Select the largest mipmap, restore top-down orientation, and undo
  premultiplied alpha.
- Parse Atlas XML files and extract their elements as PNG images.
- Read loose game image resources together with `data/databundles/images.zip`.
- Load Simplified Chinese asset names and recipe descriptions.
- Use the library programmatically or through the `dst` CLI.

Animation (`build.bin` and `anim.bin`) support is planned next.

## Requirements

- Node.js 22.14 or newer
- pnpm 10.6.4
- A local Don't Starve Together installation or a user-provided XML/TEX pair

## Development

```bash
pnpm install
pnpm check
```

Extract one atlas:

```bash
pnpm dev atlas ./inventoryimages.xml \
  --tex ./inventoryimages.tex \
  --output ./output
```

Extract matching atlases from a local game installation:

```bash
pnpm dev game "/path/to/Don't Starve Together" \
  --match inventoryimages \
  --output ./output
```

## Library usage

```ts
import { decodeKtex, parseAtlasXml } from "dstjs";
```

Focused subpath exports are also available:

```ts
import { parseAtlasXml } from "dstjs/atlas";
import { GameAssetSource } from "dstjs/game";
import { decodeKtex } from "dstjs/texture";
```

## Asset policy

DST.js does not distribute game assets. Tests use synthetic fixtures. Users
must supply files from game installations and content they are authorized to
access. The project will not provide functionality intended to bypass DLC,
skin, item-drop, or product ownership restrictions.

## License status

No public license is granted during private development. Public licensing is a
release blocker and will be decided after the provenance audit described in
[`docs/provenance.md`](docs/provenance.md).
