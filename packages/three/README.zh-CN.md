# @driftee/dstjs-three

[English](https://unpkg.com/@driftee/dstjs-three@0.1.0/README.md)

用于消费 `dstjs-web-animation` manifest 的 Three.js 渲染适配器。一个资源源统一持有
atlas 纹理、材质和 Sprite 几何体，并可创建任意数量的动画实例。

```ts
import { createDstThreeAnimationSource } from "@driftee/dstjs-three";

const source = createDstThreeAnimationSource(manifest, texture);
const animation = source.createInstance({ animation: "idle", playing: true });
scene.add(animation.object);

animation.update(deltaSeconds);
```

## 许可证

MIT
# 游戏预览入口

`@driftee/dstjs-three/preview` 提供 `DstPreviewScene`、`billboardMetrics`、`nativeCameraOffset`。默认沿用建家模拟器的 160 像素/世界单位；资源使用其他比例时，通过 `setSurface` 的 `pixelsPerWorldUnit` 传入。所有平面保留原点，共用镜头。调用方提供 Canvas 帧和 bounds，负责时钟、人物资源与业务 UI；关闭时调用 `dispose()`。完整 LUT 由 `setCube()` 注入，不随包分发游戏资源。局部光照、Bloom 和人物内部层级穿插不在当前实现范围内。
