# @driftee/dstjs-canvas

[English](https://unpkg.com/@driftee/dstjs-canvas@0.1.0/README.md)

用于播放 `dstjs-web-animation` manifest 的轻量、无 UI Canvas 播放器。

```ts
import { createDstAnimationPlayer } from "@driftee/dstjs-canvas";

const player = createDstAnimationPlayer(context, manifest, atlas, {
  animation: "idle",
  loop: true,
});

player.play();
```

资源加载、Canvas 尺寸、控制器、可见性和无障碍能力由宿主应用管理。Player
只负责播放状态和渲染。

## License

MIT
