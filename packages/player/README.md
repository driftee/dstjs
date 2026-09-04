# @driftee/dstjs-player

[简体中文](https://unpkg.com/@driftee/dstjs-player@0.1.0/README.zh-CN.md)

A lightweight, UI-free Canvas player for `dstjs-web-animation` manifests.

```ts
import { createDstAnimationPlayer } from "@driftee/dstjs-player";

const player = createDstAnimationPlayer(context, manifest, atlas, {
  animation: "idle",
  loop: true,
});

player.play();
```

The host application owns asset loading, canvas sizing, controls, visibility,
and accessibility. The player only manages playback state and rendering.

## License

MIT
