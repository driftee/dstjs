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
