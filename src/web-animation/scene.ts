import type { WebAnimationPackage } from "./types.js";

export type PetalSceneHtmlOptions = {
  title?: string;
  initialDensity?: number;
};

export function createPetalSceneHtml(
  animationPackage: WebAnimationPackage,
  options: PetalSceneHtmlOptions = {},
): string {
  const title = escapeHtml(options.title ?? "DST.js Web Animation · Petal Wind");
  const density = Math.max(4, Math.min(30, Math.round(options.initialDensity ?? 14)));
  const manifestJson = JSON.stringify(animationPackage.manifest).replaceAll("<", "\\u003c");
  const atlasSource = `data:image/webp;base64,${animationPackage.atlas.toString("base64")}`;
  const clipNames = Object.keys(animationPackage.manifest.animations);
  const clipOptions = clipNames.map((name) => `
      <label class="clip-option"><input type="checkbox" value="${escapeHtml(name)}" data-animation-clip checked><span>${escapeHtml(name)}</span></label>`).join("");
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title}</title>
  <style>
    :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    html, body { min-height: 100%; margin: 0; }
    body { overflow: hidden; background: radial-gradient(circle at 18% 12%, #ffe9ef 0, transparent 34%), linear-gradient(145deg, #f9f0e9 0%, #e8efe3 48%, #d7e7d8 100%); color: #25372d; }
    .effect-layer { position: fixed; inset: 0; width: 100%; height: 100%; pointer-events: none; }
    #effect-background { z-index: 0; }
    #effect-foreground { z-index: 2; }
    .scene { position: relative; z-index: 1; display: grid; min-height: 100svh; place-items: center; padding: 32px 32px 164px; }
    .wiki-preview { width: min(780px, 100%); padding: clamp(28px, 6vw, 64px); border: 1px solid rgba(58, 84, 68, .1); border-radius: 28px; background: rgba(255,255,255,.7); box-shadow: 0 28px 80px rgba(56, 76, 63, .14); backdrop-filter: blur(16px); }
    .eyebrow { margin: 0 0 12px; color: #a14f68; font-size: 12px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; }
    h1 { margin: 0; font-family: Georgia, "Times New Roman", serif; font-size: clamp(36px, 8vw, 72px); font-weight: 400; letter-spacing: -.04em; }
    .description { max-width: 580px; margin: 18px 0 0; color: rgba(37,55,45,.72); font-size: 16px; line-height: 1.8; }
    .controls { position: fixed; z-index: 3; right: 18px; bottom: 18px; left: 18px; display: grid; max-width: 940px; gap: 12px; margin: auto; padding: 14px; border: 1px solid rgba(58,84,68,.12); border-radius: 18px; background: rgba(255,255,255,.88); box-shadow: 0 18px 48px rgba(56,76,63,.18); backdrop-filter: blur(20px); }
    .control-row { display: flex; align-items: end; gap: 14px; }
    .control { display: grid; min-width: 118px; flex: 1; gap: 7px; color: rgba(37,55,45,.72); font-size: 12px; }
    .control strong { color: #25372d; font-weight: 650; }
    input[type="range"] { width: 100%; accent-color: #a14f68; }
    .switch { display: flex; min-height: 37px; align-items: center; gap: 8px; white-space: nowrap; }
    .switch input { accent-color: #a14f68; }
    .clip-filter { min-width: 0; margin: 0; padding: 0; border: 0; }
    .clip-filter legend { margin-bottom: 7px; padding: 0; color: rgba(37,55,45,.72); font-size: 12px; }
    .clip-filter legend strong { color: #25372d; }
    .clip-options { display: grid; grid-template-columns: repeat(10, minmax(58px, 1fr)); gap: 5px; }
    .clip-option { display: flex; min-width: 0; align-items: center; justify-content: center; gap: 5px; padding: 5px 4px; border-radius: 7px; background: rgba(37,55,45,.045); color: rgba(37,55,45,.78); font-size: 11px; white-space: nowrap; }
    .clip-option input { margin: 0; accent-color: #a14f68; }
    .clip-option:has(input:not(:checked)) { background: transparent; color: rgba(37,55,45,.42); }
    .clip-option:has(input:disabled) { opacity: .68; }
    button { min-height: 38px; padding: 0 18px; border: 0; border-radius: 10px; background: #25372d; color: #fff; cursor: pointer; font: inherit; font-weight: 650; }
    button:hover { background: #354d40; }
    button:focus-visible, input:focus-visible { outline: 3px solid rgba(161,79,104,.3); outline-offset: 2px; }
    #status { position: fixed; z-index: 3; top: 16px; right: 18px; padding: 8px 11px; border-radius: 999px; background: rgba(255,255,255,.74); color: rgba(37,55,45,.7); font-size: 12px; backdrop-filter: blur(12px); }
    @media (max-width: 720px) {
      .scene { align-items: start; padding: 24px 16px 292px; }
      .wiki-preview { margin-top: 52px; padding: 28px 24px; border-radius: 22px; }
      .control-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 14px; }
      .control-row button { grid-column: 1 / -1; }
      .clip-options { grid-template-columns: repeat(5, minmax(48px, 1fr)); }
    }
  </style>
</head>
<body>
  <canvas id="effect-background" class="effect-layer" aria-hidden="true"></canvas>
  <main class="scene">
    <article class="wiki-preview">
      <p class="eyebrow">Cherry Forest · Web scene prototype</p>
      <h1>樱花林</h1>
      <p class="description">原始 DST 花瓣动画已经转换为浏览器可识别的 WebP atlas 与动画数据。背景花瓣穿过页面空间，少量前景花瓣建立景深；页面本身只需要提供透明画布和通用场景入口。</p>
    </article>
  </main>
  <canvas id="effect-foreground" class="effect-layer" aria-hidden="true"></canvas>
  <div id="status" role="status" aria-live="polite"></div>
  <form class="controls" onsubmit="return false">
    <div class="control-row">
      <label class="control"><span>密度 <strong id="density-value">${density}</strong></span><input id="density" type="range" min="4" max="30" value="${density}"></label>
      <label class="control"><span>风向 <strong id="wind-value">22°</strong></span><input id="wind" type="range" min="-60" max="60" value="22"></label>
      <label class="control"><span>速度 <strong id="speed-value">1.0×</strong></span><input id="speed" type="range" min="0.4" max="2" value="1" step="0.1"></label>
      <label class="switch"><input id="foreground" type="checkbox" checked>显示前景</label>
      <button id="toggle" type="button">暂停</button>
    </div>
    <fieldset class="clip-filter">
      <legend>动作预设 <strong id="clip-count">${clipNames.length}/${clipNames.length}</strong></legend>
      <div class="clip-options">${clipOptions}
      </div>
    </fieldset>
  </form>
  <script id="animation-manifest" type="application/json">${manifestJson}</script>
  <script>
    (() => {
      "use strict";
      const manifest = JSON.parse(document.getElementById("animation-manifest").textContent);
      const backgroundCanvas = document.getElementById("effect-background");
      const foregroundCanvas = document.getElementById("effect-foreground");
      const background = backgroundCanvas.getContext("2d");
      const foreground = foregroundCanvas.getContext("2d");
      const densityInput = document.getElementById("density");
      const windInput = document.getElementById("wind");
      const speedInput = document.getElementById("speed");
      const foregroundInput = document.getElementById("foreground");
      const toggleButton = document.getElementById("toggle");
      const status = document.getElementById("status");
      const allClipNames = Object.keys(manifest.animations);
      const clipInputs = [...document.querySelectorAll("[data-animation-clip]")];
      let activeClipNames = [...allClipNames];
      const atlas = new Image();
      const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
      let particles = [];
      let width = innerWidth;
      let height = innerHeight;
      let dpr = 1;
      let previousTime = 0;
      let frameRequest = 0;
      let userPaused = reducedMotion.matches;
      let documentPaused = document.hidden;

      function random(min, max) { return min + Math.random() * (max - min); }
      function randomClip() { return activeClipNames[Math.floor(Math.random() * activeClipNames.length)]; }
      function resetParticle(particle, initial) {
        const clip = manifest.animations[particle.clip = randomClip()];
        particle.animationTime = initial ? random(0, clip.duration) : 0;
        particle.lifetime = random(8, 14);
        particle.lifeAge = initial ? random(0, particle.lifetime) : 0;
        particle.x = initial ? random(0, width) : random(-width * .08, width * .85);
        particle.y = initial ? random(0, height) : random(-110, 18);
        particle.scale = particle.layer === "foreground" ? random(.62, .95) : random(.28, .52);
        particle.opacity = particle.layer === "foreground" ? random(.2, .42) : random(.55, .92);
        particle.speed = random(.72, 1.28);
        particle.rotation = random(-.15, .15);
      }
      function reconcileParticles() {
        const target = Number(densityInput.value);
        const foregroundCount = foregroundInput.checked ? Math.max(1, Math.round(target * .18)) : 0;
        const backgroundCount = target - foregroundCount;
        const existingBackground = particles.filter((particle) => particle.layer === "background");
        const existingForeground = particles.filter((particle) => particle.layer === "foreground");
        while (existingBackground.length < backgroundCount) {
          const particle = { layer: "background" };
          resetParticle(particle, true);
          existingBackground.push(particle);
        }
        while (existingForeground.length < foregroundCount) {
          const particle = { layer: "foreground" };
          resetParticle(particle, true);
          existingForeground.push(particle);
        }
        particles = existingBackground.slice(0, backgroundCount).concat(existingForeground.slice(0, foregroundCount));
        updateStatus();
      }
      function resize() {
        width = innerWidth;
        height = innerHeight;
        dpr = Math.min(devicePixelRatio || 1, 1.5);
        for (const canvas of [backgroundCanvas, foregroundCanvas]) {
          canvas.width = Math.round(width * dpr);
          canvas.height = Math.round(height * dpr);
          canvas.style.width = width + "px";
          canvas.style.height = height + "px";
        }
      }
      function clear(context) {
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.clearRect(0, 0, context.canvas.width, context.canvas.height);
        context.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      function drawParticle(context, particle) {
        const clip = manifest.animations[particle.clip];
        const frame = clip.frames[Math.min(clip.frames.length - 1, Math.floor(particle.animationTime * clip.frameRate))];
        if (!frame) return;
        context.save();
        context.globalAlpha = particle.opacity;
        context.translate(particle.x, particle.y);
        context.rotate(particle.rotation);
        context.scale(particle.scale, particle.scale);
        for (const element of frame.elements) {
          const sprite = manifest.sprites[element.sprite];
          if (!sprite) continue;
          const [a, b, c, d, tx, ty] = element.transform;
          context.save();
          context.transform(a, -c, -b, d, tx, -ty);
          context.drawImage(atlas, sprite.x, sprite.y, sprite.width, sprite.height, -sprite.originX, -sprite.originY, sprite.width, sprite.height);
          context.restore();
        }
        context.restore();
      }
      function render(time) {
        if (userPaused || documentPaused || !atlas.complete) return;
        const delta = previousTime === 0 ? 0 : Math.min(.05, (time - previousTime) / 1000);
        previousTime = time;
        clear(background);
        clear(foreground);
        const angle = Number(windInput.value) * Math.PI / 180;
        const sceneSpeed = Number(speedInput.value);
        for (const particle of particles) {
          const clip = manifest.animations[particle.clip];
          particle.animationTime = (particle.animationTime + delta) % clip.duration;
          particle.lifeAge += delta;
          const velocity = 54 * sceneSpeed * particle.speed;
          particle.x += Math.sin(angle) * velocity * delta;
          particle.y += Math.cos(angle) * velocity * delta;
          particle.rotation += Math.sin(particle.animationTime * 2.1) * delta * .08;
          if (particle.lifeAge >= particle.lifetime || particle.x < -220 || particle.x > width + 220 || particle.y > height + 220) resetParticle(particle, false);
          drawParticle(particle.layer === "foreground" ? foreground : background, particle);
        }
        frameRequest = requestAnimationFrame(render);
      }
      function start() {
        cancelAnimationFrame(frameRequest);
        previousTime = 0;
        if (!userPaused && !documentPaused && atlas.complete) frameRequest = requestAnimationFrame(render);
        updateStatus();
      }
      function updateStatus() {
        const paused = userPaused || documentPaused;
        status.textContent = paused ? (reducedMotion.matches ? "已按系统偏好减少动态效果" : "已暂停") : "播放中 · " + particles.length + " 片花瓣";
        toggleButton.textContent = userPaused ? "播放" : "暂停";
      }
      function updateClipSelection(changedInput) {
        const checkedInputs = clipInputs.filter((input) => input.checked);
        if (checkedInputs.length === 0 && changedInput) {
          changedInput.checked = true;
          return updateClipSelection();
        }
        activeClipNames = checkedInputs.map((input) => input.value);
        for (const input of clipInputs) input.disabled = activeClipNames.length === 1 && input.checked;
        document.getElementById("clip-count").textContent = activeClipNames.length + "/" + allClipNames.length;
        for (const particle of particles) {
          if (!activeClipNames.includes(particle.clip)) resetParticle(particle, false);
        }
      }

      densityInput.addEventListener("input", () => {
        document.getElementById("density-value").textContent = densityInput.value;
        reconcileParticles();
      });
      windInput.addEventListener("input", () => { document.getElementById("wind-value").textContent = windInput.value + "°"; });
      speedInput.addEventListener("input", () => { document.getElementById("speed-value").textContent = Number(speedInput.value).toFixed(1) + "×"; });
      foregroundInput.addEventListener("change", reconcileParticles);
      for (const input of clipInputs) input.addEventListener("change", () => updateClipSelection(input));
      toggleButton.addEventListener("click", () => { userPaused = !userPaused; start(); });
      reducedMotion.addEventListener("change", (event) => { userPaused = event.matches; start(); });
      document.addEventListener("visibilitychange", () => { documentPaused = document.hidden; start(); });
      addEventListener("resize", () => { resize(); reconcileParticles(); });
      addEventListener("pagehide", () => cancelAnimationFrame(frameRequest));
      atlas.addEventListener("load", () => { resize(); reconcileParticles(); start(); });
      atlas.src = "${atlasSource}";
    })();
  </script>
</body>
</html>
`;
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
