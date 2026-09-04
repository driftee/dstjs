# DST.js

[English](https://github.com/driftee/dstjs/blob/main/README.md)

DST.js 是一个用于解析、提取、转换和渲染《Don't Starve Together》
资源的 TypeScript 工具包。

> [!IMPORTANT]
> DST.js 是独立的非官方项目，与 Klei Entertainment 无关，也未获得其认可。
> Don't Starve 与 Don't Starve Together 是 Klei Entertainment 的商标。

DST.js 以独立 Node.js 包和命令行工具的形式发布。

## 当前能力

- 解码 DXT1、DXT3、DXT5、RGB 和 RGBA 压缩的 KTEX 纹理。
- 支持保留地皮纹理原始 RGB，以及默认解除精灵纹理的预乘 Alpha。
- 编码用于诊断工具的无压缩 RGBA KTEX 纹理。
- 解析 Atlas XML，并将其中的元素提取为 PNG。
- 裁剪 PNG/GIF 的透明边缘，并支持分别配置四边留白。
- 读取松散图片、大头像以及 `images.zip`、`bigportraits.zip` 中的游戏资源。
- 加载简体中文资源名称和料理描述。
- 解析 ANIM v3/v4 与 BILD v5/v6 文件。
- 检查单体或拆分的动画 ZIP，并输出 PNG 帧或 GIF。
- 支持 facing、symbol override、隐藏图层和独立 build 包。
- 将 DST 动画编译为 WebP 精灵图和浏览器可读的 JSON。
- 生成动画播放器和双层 Canvas 场景。
- 采集、识别并生成地皮渲染数据。
- 静态提取原版及模组料理、地皮和相关资源目录。
- 通过 JavaScript API 或 `dst` CLI 使用。

直接 PNG 渲染器和 Web 编译器都会栅格化 build 三角网格。更多真实资源的
兼容性仍在持续验证。

## 环境要求

- Node.js 22.14 或更高版本。
- pnpm 10.6.4。
- 本地《Don't Starve Together》安装目录，或用户自行提供的资源文件。

## 开发

```bash
pnpm install
pnpm check
```

## 常用命令

提取 Atlas：

```bash
pnpm dev atlas ./inventoryimages.xml \
  --tex ./inventoryimages.tex \
  --output ./output
```

解码单独的 KTEX：

```bash
pnpm dev texture decode ./noise_cherrygreen.tex \
  --output ./output/noise-cherrygreen.png
```

裁剪图片透明边缘：

```bash
pnpm dev image prune ./output/frame.png \
  --padding 4 \
  --padding-bottom 10 \
  --output ./output/frame-pruned.png
```

从游戏目录中提取匹配的 Atlas：

```bash
pnpm dev game "/path/to/Don't Starve Together" \
  --match inventoryimages \
  --output ./output
```

检查并渲染动画：

```bash
pnpm dev anim inspect ./firefighter_projectile.zip

pnpm dev anim frame ./firefighter_projectile.zip \
  --animation spin_loop \
  --frame 3 \
  --scale 4 \
  --output ./output/firefighter-projectile.png

pnpm dev anim gif \
  --anim ./ds_pig_basic.zip \
  --build ./pig_build.zip \
  --animation idle_loop \
  --facing 8 \
  --skip-missing-symbols \
  --scale 2 \
  --output ./output/pig-idle.gif
```

生成浏览器动画包：

```bash
pnpm dev anim web ./cherrytree_petal_fx.zip \
  --override autumn=spring \
  --variant spring:autumn=spring \
  --variant autumn:autumn=autumn \
  --demo \
  --output ./output/cherry-petal-web
```

导出料理目录：

```bash
pnpm dev cooking catalog "/path/to/game/Contents/data" \
  --output ./output/cooking-catalog
```

导出地皮目录：

```bash
pnpm dev turf catalog "/path/to/game/Contents/data" \
  ./output/turf-native-lookup.json \
  --output ./output/turf-catalog
```

导出模组地皮资源：

```bash
pnpm dev turf mod-catalog \
  ./workshop/1289779251 \
  ./output/turf-catalog/catalog.json \
  cherry-forest \
  1289779251 \
  --output ./output/turf-catalog
```

所有游戏资源均从用户提供的本地文件读取，不随 npm 包分发。

导出 Lottie JSON：

```bash
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

```

通用 Sprite Animation IR 可供 Web、Lottie 和后续 DST 反向编译器共同使用。
每个 IR Transform 同时包含作为保真基线的仿射 `matrix`，以及供编辑器使用的
`channels`（`position`、`rotation`、`scale` 和 `skewX`）。公共 Transform
helper 负责从导入矩阵分解通道，并在通道编辑后重新合成矩阵，使渲染器保留源数据，
未来的编辑器也能共用同一套变换模型。这些平台无关的类型与算法位于
`@driftee/dstjs-core`，当前包仍会兼容性地重新导出。

Lottie 导出器会确定性地匹配跨帧元素，并分别支持以下关键帧模式：

- `lossless` 或 `0`：逐帧 Hold Keyframe，无损且为默认模式。
- `linear` 或 `1`：只合并能够精确线性重建的区间。
- `visual` 或 `2`：按 Sprite 四角的屏幕像素误差简化，
  `--keyframe-tolerance` 默认为 `0.25` 像素。

当 Sprite 或绘制顺序改变时会切分图层。普通仿射斜切通过 Lottie 的 `sk` / `sa`
通道保留；只有编辑通道无法重建的退化矩阵才会明确报错。
使用 `--external-images` 可将图片按内容哈希输出到 `images/`，避免 Base64 内嵌。

## 程序调用

```ts
import { decodeKtex, parseAtlasXml } from "@driftee/dstjs";
```

也可以使用按功能拆分的子路径：

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

## 资源政策

DST.js 不分发游戏资源。测试使用合成数据。用户必须自行提供本地游戏安装中的
文件，或自己拥有访问权限的内容。本项目不提供绕过 DLC、皮肤、物品掉落或产品
所有权限制的功能。

## License

DST.js 使用 MIT License。第三方声明见 `NOTICE.md` 和 `third_party/`。
