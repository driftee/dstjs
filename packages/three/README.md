# @driftee/dstjs-three

[简体中文](https://unpkg.com/@driftee/dstjs-three@0.1.0/README.zh-CN.md)

A Three.js rendering adapter for `dstjs-web-animation` manifests. One source
owns the shared atlas texture, material, and sprite geometries; any number of
animation instances can be created from it.

```ts
import { createDstThreeAnimationSource } from "@driftee/dstjs-three";

const source = createDstThreeAnimationSource(manifest, texture);
const animation = source.createInstance({ animation: "idle", playing: true });
scene.add(animation.object);

animation.update(deltaSeconds);
```

## License

MIT
