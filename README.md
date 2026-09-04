# DST.js

[简体中文](https://github.com/driftee/dstjs/blob/main/README.zh-CN.md)

A TypeScript toolkit for parsing, extracting, converting, and rendering
Don't Starve Together assets.

> [!IMPORTANT]
> DST.js is an independent, unofficial project. It is not affiliated with or
> endorsed by Klei Entertainment. Don't Starve and Don't Starve Together are
> trademarks of Klei Entertainment.

DST.js is distributed as a standalone Node.js package and command-line tool.

## Current capabilities

- Decode KTEX textures using DXT1, DXT3, DXT5, RGB, or RGBA compression.
- Ground atlas/noise/falloff exports preserve stored RGB via `decodeKtex(input, { unpremultiplyAlpha: false })`, matching native ground shader sampling. Sprite and inventory exports keep the default alpha unpremultiplication.
- Turf catalogs export `MONKEY_DOCK` separately in `structures`, using its real `dock_kit` inventory icon/name. Ocean assets include the dedicated `dockFalloff` atlas; this does not add a fake `turf_monkey_dock` to the normal turf palette.
- Encode synthetic uncompressed RGBA KTEX textures for diagnostic tooling.
- Select the largest mipmap, restore top-down orientation, and undo
  premultiplied alpha.
- Parse Atlas XML files and extract their elements as PNG images.
- Prune transparent borders from rendered PNG/GIF outputs with configurable
  per-side padding.
- Read loose game image and portrait resources together with
  `data/databundles/images.zip` and `data/databundles/bigportraits.zip`.
- Load Simplified Chinese asset names and recipe descriptions.
- Decode ANIM v3/v4 and BILD v5/v6 files with bounded binary reads.
- Inspect self-contained animation ZIP files and render PNG frames or frame
  sequences through an experimental renderer.
- Reuse atlas and sprite image definitions while composing SVG frames, avoiding
  Base64 duplication for complex animations with many triangles or elements.
- Combine split DST animation packages, where one ZIP provides `anim.bin` and
  another provides `build.bin` plus atlases, then export GIFs or PNG frames for
  a selected animation clip.
- Compile DST animations into a browser-readable WebP sprite atlas and JSON
  manifest, including symbol overrides and triangle-mesh rasterization.
- Generate a standalone two-layer Canvas scene demo with interactive density,
  wind, speed, animation-clip filtering, foreground, and playback controls.
- Use the library programmatically or through the `dst` CLI.

The direct PNG frame renderer and Web compiler rasterize build triangle meshes.
Broader real-world compatibility remains under active validation.

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

Decode a standalone KTEX texture without an Atlas XML file:

```bash
pnpm dev texture decode ./noise_cherrygreen.tex \
  --output ./output/noise-cherrygreen.png
```

Crop transparent borders from a rendered PNG or GIF. `--padding` applies to
all sides, and side-specific options override it:

```bash
pnpm dev image prune ./output/frame.png \
  --padding 4 \
  --padding-bottom 10 \
  --output ./output/frame-pruned.png
```

Generate the synthetic atlas and noise texture used by the turf calibration
mod:

```bash
pnpm dev turf calibration-assets \
  --output ./examples/dstjs-turf-calibrator
```

After a calibration run, parse its machine-readable server-log markers and
create the 256-entry observation skeleton:

```bash
pnpm dev turf parse-log ./server_log.txt \
  --output ./output/calibration-run.json
```

Recognize a completed centre-background calibration run. The decoder reads the
single centre element for each mask, using its six-bit barcode as the primary
signal and the seven-segment number as an optional consistency check:

```bash
pnpm dev turf recognize-native ./output/turf-captures-v2 \
  --output ./output/turf-native-lookup.json
```

Generate the local interactive simulator from an installed game. Original game
textures remain local and are not included in the repository:

```bash
pnpm dev turf simulator "/path/to/game/Contents/data" \
  ./output/turf-native-lookup.json \
  --output ./output/turf-simulator
```

The simulator starts in an angled game-style camera. Click or drag to paint,
use the arrow controls to change turf precedence, and switch to the top-down
debug view when inspecting individual cells.

Export a reusable vanilla inventory turf catalog:

```bash
node --import tsx src/cli.ts turf catalog "/path/to/game/Contents/data" \
  ./output/turf-native-lookup.json \
  --output ./output/turf-catalog
```

This reads literal `TileManager.AddTile` registrations without executing Lua,
preserves the game's render order, resolves Chinese inventory names from the
game's PO file, and extracts icons from the numbered inventory atlases. The
current installation exports 40 inventory-backed turfs, the DIRT eraser base,
and the pitchfork icon. Non-inventory terrain is listed separately in
`catalog.json`; no substitute icons or inventory names are invented. All
exported game resources stay local.

The catalog command also exports `grading.json` and raw 32³ RGBA colour cubes
referenced by the game's `components/colourcube.lua`. It preserves the actual
season/phase pairings (including spring night using the spring dusk cube),
and does not execute Lua.

Export the minimum turf package for a supported third-party mod:

```bash
node --import tsx src/cli.ts turf mod-catalog \
  ./workshop/1289779251 \
  ./output/turf-catalog/catalog.json \
  cherry-forest 1289779251 \
  --output ./output/turf-catalog
```

This statically reads literal `AddTile` and `ChangeTileRenderOrder` calls,
decodes only the referenced ground atlases and noise textures, and crops the
required inventory icons. It does not execute mod Lua or copy unrelated mod
assets. Output is namespaced under `mods/<package-id>/`.

The vanilla catalog command also exports `ocean.json` and the minimum
`OCEAN_COASTAL` assets: the original three-layer ocean noise parameters,
land falloff atlas, and compact `wave_shore` / `wave_shimmer` sprite sheets.
They can be regenerated independently with:

```bash
node --import tsx src/cli.ts turf ocean-assets "$GAME_DATA" \
  --output ./output/turf-catalog
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
pnpm dev anim gif ./firefighter_projectile.zip \
  --animation spin_loop \
  --scale 4 \
  --output ./output/firefighter-projectile.gif

pnpm dev anim inspect --anim ./ds_pig_basic.zip
pnpm dev anim gif \
  --anim ./ds_pig_basic.zip \
  --build ./pig_build.zip \
  --animation idle_loop \
  --facing 8 \
  --skip-missing-symbols \
  --scale 2 \
  --output ./output/pig-idle.gif

pnpm dev anim lottie ./shadow_skittish.zip \
  --animation idle_loop \
  --output ./output/shadow-skittish.lottie.json

pnpm dev anim lottie ./shadow_skittish.zip \
  --animation idle_loop \
  --external-images \
  --output ./output/shadow-skittish/animation.json

pnpm dev anim lottie ./shadow_skittish.zip \
  --animation idle_loop \
  --keyframe-mode visual \
  --keyframe-tolerance 0.25 \
  --output ./output/shadow-skittish-visual.lottie.json

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

The target-neutral sprite animation package is also available as a public API.
Each IR transform contains both an authoritative affine `matrix` and editable
`channels` (`position`, `rotation`, `scale`, and `skewX`). Public transform
helpers decompose imported matrices and recompose matrices after channel edits,
so renderers retain source fidelity while future editors share one transform
model.

The Lottie exporter deterministically tracks matching elements across frames.
Its keyframe modes are `lossless`/`0` for per-frame hold keyframes (the
default), `linear`/`1` for exact linear interval merging, and `visual`/`2` for
pixel-error simplification. `--keyframe-tolerance` controls the visual mode and
defaults to `0.25` pixels. The exporter splits a layer when its sprite or draw
order changes, preserves affine skew through Lottie's `sk`/`sa` channels, and
rejects only degenerate matrices that the editable channel model cannot
reproduce. Use `--external-images` to write content-addressed PNG files under
`images/` instead of embedding them as Base64.

## Library usage

```ts
import { decodeKtex, parseAtlasXml } from "@driftee/dstjs";
```

Focused subpath exports are also available:

```ts
import { parseAtlasXml } from "@driftee/dstjs/atlas";
import { openAnimationBundle, renderAnimationFrame } from "@driftee/dstjs/animation";
import { GameAssetSource } from "@driftee/dstjs/game";
import { compileLottieAnimation } from "@driftee/dstjs/lottie";
import { pruneTransparentImage } from "@driftee/dstjs/image";
import { compileDstSpriteAnimation } from "@driftee/dstjs/sprite-animation";
import { decodeKtex } from "@driftee/dstjs/texture";
import { compileWebAnimation, createPetalSceneHtml } from "@driftee/dstjs/web-animation";
```

## Asset policy

DST.js does not distribute game assets. Tests use synthetic fixtures. Users
must supply files from game installations and content they are authorized to
access. The project will not provide functionality intended to bypass DLC,
skin, item-drop, or product ownership restrictions.

## License

DST.js is released under the MIT License. Third-party notices are listed in
`NOTICE.md` and `third_party/`.
