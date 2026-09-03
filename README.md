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
- Decode ANIM v3/v4 and BILD v5/v6 files with bounded binary reads.
- Inspect self-contained animation ZIP files and render PNG frames or frame
  sequences through an experimental renderer.
- Compile DST animations into a browser-readable WebP sprite atlas and JSON
  manifest, including symbol overrides and triangle-mesh rasterization.
- Generate a standalone two-layer Canvas scene demo with interactive density,
  wind, speed, animation-clip filtering, foreground, and playback controls.
- Use the library programmatically or through the `dst` CLI.

The direct PNG frame renderer currently supports the common rectangular symbol
case. The Web compiler rasterizes triangle meshes before packing its sprite
atlas. Broader real-world compatibility remains under active validation.

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

Inspect and render an animation ZIP:

```bash
pnpm dev anim inspect ./firefighter_projectile.zip
pnpm dev anim frame ./firefighter_projectile.zip \
  --animation spin_loop \
  --frame 3 \
  --scale 4 \
  --output ./output/firefighter-projectile.png
pnpm dev anim frames ./firefighter_projectile.zip \
  --animation spin_loop \
  --scale 4 \
  --output ./output/firefighter-projectile-frames

pnpm dev anim web ./cherrytree_petal_fx.zip \
  --override autumn=spring \
  --variant spring:autumn=spring \
  --variant autumn:autumn=autumn \
  --variant summer:autumn=summer \
  --variant winter:autumn=winter \
  --variant cheerful:autumn=cheerful \
  --variant hibeescus:autumn=hibeescus \
  --demo \
  --output ./output/cherry-petal-web
```

The `anim web` command writes `animation.json` and `atlas.webp`. With `--demo`,
it also writes a self-contained `index.html` that demonstrates scene
orchestration independently of any Wiki implementation.

`anim effect` writes a self-contained JavaScript effect package implementing the
QiNeko Wiki effect runtime contract. The generated script carries the
`qineko-wiki-effect-package:v1` format header required by the Wiki upload API.
Animation selection can omit unwanted clips, while repeated `--variant` options
embed theme-specific atlases.

## Library usage

```ts
import { decodeKtex, parseAtlasXml } from "dstjs";
```

Focused subpath exports are also available:

```ts
import { parseAtlasXml } from "dstjs/atlas";
import { openAnimationBundle, renderAnimationFrame } from "dstjs/animation";
import { GameAssetSource } from "dstjs/game";
import { decodeKtex } from "dstjs/texture";
import { compileWebAnimation, createPetalSceneHtml } from "dstjs/web-animation";
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
