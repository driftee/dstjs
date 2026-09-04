import type {
  WebAnimationClip,
  WebAnimationManifest,
  WebAnimationPackage,
} from "./types.js";

export type AnimationPlayerHtmlOptions = {
  title?: string;
  initialAnimation?: string;
};

type Bounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export function createAnimationPlayerHtml(
  animationPackage: WebAnimationPackage,
  options: AnimationPlayerHtmlOptions = {},
): string {
  const animationNames = Object.keys(animationPackage.manifest.animations);
  const initialAnimation = options.initialAnimation ?? animationNames[0];
  if (!initialAnimation || !animationPackage.manifest.animations[initialAnimation]) {
    throw new Error(`找不到初始动画 ${initialAnimation ?? ""}`);
  }
  const title = escapeHtml(options.title ?? "DST.js 动画播放器");
  const packageJson = JSON.stringify({
    manifest: animationPackage.manifest,
    bounds: Object.fromEntries(Object.entries(animationPackage.manifest.animations).map(([name, clip]) => [
      name,
      animationBounds(animationPackage.manifest, clip),
    ])),
    atlas: `data:image/webp;base64,${Buffer.from(animationPackage.atlas).toString("base64")}`,
  }).replaceAll("<", "\\u003c");
  const animationOptions = animationNames.map((name) =>
    `<option value="${escapeHtml(name)}"${name === initialAnimation ? " selected" : ""}>${escapeHtml(name)}</option>`).join("");

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title}</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    html, body { width: 100%; min-height: 100%; margin: 0; }
    body { overflow: hidden; background: #151817; color: #f3f4ef; }
    .stage { position: fixed; inset: 0; background: radial-gradient(circle at 50% 45%, #4a504b 0, #252a27 38%, #131615 78%); }
    .stage::before { position: absolute; inset: 0; background-image: linear-gradient(45deg, rgba(255,255,255,.018) 25%, transparent 25%, transparent 75%, rgba(255,255,255,.018) 75%), linear-gradient(45deg, rgba(255,255,255,.018) 25%, transparent 25%, transparent 75%, rgba(255,255,255,.018) 75%); background-position: 0 0, 18px 18px; background-size: 36px 36px; content: ""; }
    canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
    header { position: fixed; z-index: 2; top: 24px; left: 28px; pointer-events: none; }
    .eyebrow { margin: 0 0 6px; color: #aeb9b0; font-size: 11px; font-weight: 700; letter-spacing: .16em; text-transform: uppercase; }
    h1 { margin: 0; font-family: Georgia, "Times New Roman", serif; font-size: clamp(30px, 5vw, 54px); font-weight: 400; letter-spacing: -.035em; }
    #status { margin: 8px 0 0; color: rgba(243,244,239,.62); font-size: 12px; }
    .controls { position: fixed; z-index: 2; right: 18px; bottom: 18px; left: 18px; display: flex; max-width: 760px; align-items: end; gap: 12px; margin: auto; padding: 14px; border: 1px solid rgba(255,255,255,.1); border-radius: 18px; background: rgba(26,30,28,.86); box-shadow: 0 18px 54px rgba(0,0,0,.34); backdrop-filter: blur(18px); }
    label { display: grid; min-width: 126px; flex: 1; gap: 7px; color: rgba(243,244,239,.65); font-size: 11px; }
    label span { display: flex; justify-content: space-between; gap: 12px; }
    select { width: 100%; min-height: 38px; padding: 0 10px; border: 1px solid rgba(255,255,255,.14); border-radius: 9px; background: #272c29; color: #f3f4ef; font: inherit; }
    input[type="range"] { width: 100%; min-height: 38px; accent-color: #b8c8ba; }
    .loop { display: flex; min-width: auto; flex: 0 0 auto; grid-template-columns: auto auto; align-items: center; gap: 7px; padding: 0 3px 10px; white-space: nowrap; }
    .loop input { margin: 0; accent-color: #b8c8ba; }
    button { min-height: 40px; padding: 0 16px; border: 1px solid rgba(255,255,255,.12); border-radius: 10px; background: #e7ebe5; color: #202421; cursor: pointer; font: inherit; font-weight: 700; }
    button.secondary { background: #303632; color: #f3f4ef; }
    button:hover { filter: brightness(1.08); }
    button:focus-visible, input:focus-visible, select:focus-visible { outline: 3px solid rgba(184,200,186,.3); outline-offset: 2px; }
    @media (max-width: 660px) {
      header { top: 18px; left: 18px; }
      .controls { display: grid; grid-template-columns: 1fr 1fr; }
      .loop { padding-bottom: 4px; }
    }
  </style>
</head>
<body>
  <main class="stage"><canvas id="player" aria-label="DST 动画画布"></canvas></main>
  <header>
    <p class="eyebrow">DST.js · Entity animation</p>
    <h1>${title}</h1>
    <p id="status" role="status" aria-live="polite">正在加载贴图…</p>
  </header>
  <form class="controls" onsubmit="return false">
    <label><span>动作</span><select id="animation">${animationOptions}</select></label>
    <label><span>速度 <strong id="speed-value">1.0×</strong></span><input id="speed" type="range" min="0.2" max="2" value="1" step="0.1"></label>
    <label class="loop"><input id="loop" type="checkbox"><span>循环</span></label>
    <button id="replay" class="secondary" type="button">重播</button>
    <button id="toggle" type="button">暂停</button>
  </form>
  <script id="animation-package" type="application/json">${packageJson}</script>
  <script>
    (() => {
      "use strict";
      const packageData = JSON.parse(document.getElementById("animation-package").textContent);
      const manifest = packageData.manifest;
      const canvas = document.getElementById("player");
      const context = canvas.getContext("2d");
      const animationInput = document.getElementById("animation");
      const speedInput = document.getElementById("speed");
      const speedValue = document.getElementById("speed-value");
      const loopInput = document.getElementById("loop");
      const replayButton = document.getElementById("replay");
      const toggleButton = document.getElementById("toggle");
      const status = document.getElementById("status");
      const atlas = new Image();
      const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
      let animationName = animationInput.value;
      let animationTime = 0;
      let playing = !reducedMotion.matches;
      let previousTime = 0;
      let frameRequest = 0;
      let width = innerWidth;
      let height = innerHeight;
      let dpr = 1;

      function defaultLoop(name) { return /(?:^|_)loop(?:$|_)/i.test(name); }
      function resize() {
        width = innerWidth;
        height = innerHeight;
        dpr = Math.min(devicePixelRatio || 1, 2);
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        canvas.style.width = width + "px";
        canvas.style.height = height + "px";
        draw();
      }
      function draw() {
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.clearRect(0, 0, canvas.width, canvas.height);
        const clip = manifest.animations[animationName];
        const frameIndex = Math.min(clip.frames.length - 1, Math.floor(animationTime * clip.frameRate));
        const frame = clip.frames[frameIndex];
        const bounds = packageData.bounds[animationName];
        const boundsWidth = Math.max(1, bounds.right - bounds.left);
        const boundsHeight = Math.max(1, bounds.bottom - bounds.top);
        const availableHeight = Math.max(160, height - 170);
        const scale = Math.min(width * .66 / boundsWidth, availableHeight * .72 / boundsHeight, 3.2);
        const centerX = (bounds.left + bounds.right) / 2;
        const centerY = (bounds.top + bounds.bottom) / 2;
        context.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * (width / 2 - centerX * scale), dpr * (availableHeight / 2 + 34 - centerY * scale));
        for (const element of frame.elements) {
          const sprite = manifest.sprites[element.sprite];
          if (!sprite) continue;
          const [a, b, c, d, tx, ty] = element.transform;
          context.save();
          context.transform(a, b, c, d, tx, ty);
          context.drawImage(atlas, sprite.x, sprite.y, sprite.width, sprite.height, -sprite.originX, -sprite.originY, sprite.width, sprite.height);
          context.restore();
        }
        status.textContent = animationName + " · " + (frameIndex + 1) + "/" + clip.frames.length + " 帧 · " + clip.frameRate + " FPS";
      }
      function render(time) {
        if (!playing) return;
        const delta = previousTime === 0 ? 0 : Math.min(.05, (time - previousTime) / 1000);
        previousTime = time;
        const clip = manifest.animations[animationName];
        animationTime += delta * Number(speedInput.value);
        if (animationTime >= clip.duration) {
          if (loopInput.checked) animationTime %= clip.duration;
          else {
            animationTime = Math.max(0, clip.duration - 1 / clip.frameRate);
            playing = false;
          }
        }
        draw();
        updateControls();
        if (playing) frameRequest = requestAnimationFrame(render);
      }
      function start() {
        cancelAnimationFrame(frameRequest);
        previousTime = 0;
        if (playing && atlas.complete) frameRequest = requestAnimationFrame(render);
        updateControls();
      }
      function replay() {
        animationTime = 0;
        playing = true;
        draw();
        start();
      }
      function updateControls() {
        toggleButton.textContent = playing ? "暂停" : "播放";
        speedValue.textContent = Number(speedInput.value).toFixed(1) + "×";
      }

      loopInput.checked = defaultLoop(animationName);
      animationInput.addEventListener("change", () => {
        animationName = animationInput.value;
        loopInput.checked = defaultLoop(animationName);
        replay();
      });
      speedInput.addEventListener("input", updateControls);
      replayButton.addEventListener("click", replay);
      toggleButton.addEventListener("click", () => { playing = !playing; start(); });
      addEventListener("resize", resize);
      document.addEventListener("visibilitychange", () => {
        if (document.hidden) cancelAnimationFrame(frameRequest);
        else start();
      });
      atlas.addEventListener("load", () => { resize(); start(); });
      atlas.addEventListener("error", () => { status.textContent = "贴图加载失败"; });
      atlas.src = packageData.atlas;
      updateControls();
    })();
  </script>
</body>
</html>`;
}

function animationBounds(manifest: WebAnimationManifest, clip: WebAnimationClip): Bounds {
  const bounds: Bounds = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
  for (const frame of clip.frames) {
    for (const element of frame.elements) {
      const sprite = manifest.sprites[element.sprite];
      if (!sprite) continue;
      const [a, b, c, d, tx, ty] = element.transform;
      const corners = [
        [-sprite.originX, -sprite.originY],
        [sprite.width - sprite.originX, -sprite.originY],
        [-sprite.originX, sprite.height - sprite.originY],
        [sprite.width - sprite.originX, sprite.height - sprite.originY],
      ];
      for (const [x = 0, y = 0] of corners) {
        const transformedX = a * x + c * y + tx;
        const transformedY = b * x + d * y + ty;
        bounds.left = Math.min(bounds.left, transformedX);
        bounds.top = Math.min(bounds.top, transformedY);
        bounds.right = Math.max(bounds.right, transformedX);
        bounds.bottom = Math.max(bounds.bottom, transformedY);
      }
    }
  }
  return Number.isFinite(bounds.left) ? bounds : { left: -1, top: -1, right: 1, bottom: 1 };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
