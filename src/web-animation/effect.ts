import { petalDensityForViewport, petalThemeForDate, petalWindAngleAt } from "./petal-policy.js";
import type { PetalTheme } from "./petal-policy.js";
import type { WebAnimationPackage } from "./types.js";

export type PetalEffectScriptOptions = {
  name?: string;
  speed?: number;
};

export const WIKI_EFFECT_PACKAGE_HEADER = "/* qineko-wiki-effect-package:v1 */";

export function createPetalEffectScript(
  variants: Readonly<Record<PetalTheme, WebAnimationPackage>>,
  options: PetalEffectScriptOptions = {},
): string {
  const name = JSON.stringify(options.name ?? "cherry-petal-effect");
  const speed = Math.max(0.1, Math.min(4, options.speed ?? 1.2));
  const packages = JSON.stringify(Object.fromEntries(Object.entries(variants).map(([theme, variant]) => [theme, {
    manifest: variant.manifest,
    atlas: `data:image/webp;base64,${variant.atlas.toString("base64")}`,
  }]))).replaceAll("<", "\\u003c");
  const requiredThemes: PetalTheme[] = ["spring", "summer", "autumn", "winter", "cheerful", "hibeescus"];
  for (const theme of requiredThemes) {
    if (!variants[theme]) throw new Error(`缺少花瓣贴图主题 ${theme}`);
  }
  return `${WIKI_EFFECT_PACKAGE_HEADER}
(() => {
  "use strict";
  const packages = ${packages};
  const themeForDate = ${petalThemeForDate.toString()};
  const densityForViewport = ${petalDensityForViewport.toString()};
  const windAngleAt = ${petalWindAngleAt.toString()};
  let activeController = null;

  globalThis.QinekoWikiEffectPackage = Object.freeze({
    version: 1,
    name: ${name},
    async mount(options = {}) {
      activeController?.destroy();
      const backgroundCanvas = document.createElement("canvas");
      const foregroundCanvas = document.createElement("canvas");
      for (const [canvas, layer, zIndex] of [[backgroundCanvas, "background", "0"], [foregroundCanvas, "foreground", "30"]]) {
        canvas.dataset.qinekoEffectLayer = layer;
        canvas.setAttribute("aria-hidden", "true");
        Object.assign(canvas.style, { position: "fixed", inset: "0", width: "100%", height: "100%", pointerEvents: "none", zIndex });
        document.body.append(canvas);
      }
      const background = backgroundCanvas.getContext("2d");
      const foreground = foregroundCanvas.getContext("2d");
      if (!background || !foreground) {
        backgroundCanvas.remove();
        foregroundCanvas.remove();
        throw new Error("浏览器不支持 Canvas 2D");
      }

      let manifest;
      let atlas;
      let currentTheme = "";
      let themeRequest = 0;
      let particles = [];
      let width = innerWidth;
      let height = innerHeight;
      let dpr = 1;
      let previousTime = 0;
      let frameRequest = 0;
      let enabled = options.enabled !== false;
      let destroyed = false;

      function random(min, max) { return min + Math.random() * (max - min); }
      function randomClip() {
        const names = Object.keys(manifest.animations);
        return names[Math.floor(Math.random() * names.length)];
      }
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
        if (!manifest) return;
        const target = densityForViewport(width, height);
        const foregroundCount = Math.max(1, Math.round(target * .18));
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
        reconcileParticles();
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
      function fail(error) {
        controller.destroy();
        if (typeof options.onError === "function") options.onError(error);
      }
      function render(time) {
        if (!enabled || destroyed || document.hidden || !atlas) return;
        try {
          const delta = previousTime === 0 ? 0 : Math.min(.05, (time - previousTime) / 1_000);
          previousTime = time;
          clear(background);
          clear(foreground);
          const angle = windAngleAt(Date.now()) * Math.PI / 180;
          for (const particle of particles) {
            const clip = manifest.animations[particle.clip];
            particle.animationTime = (particle.animationTime + delta) % clip.duration;
            particle.lifeAge += delta;
            const velocity = 54 * ${speed} * particle.speed;
            particle.x += Math.sin(angle) * velocity * delta;
            particle.y += Math.cos(angle) * velocity * delta;
            particle.rotation += Math.sin(particle.animationTime * 2.1) * delta * .08;
            if (particle.lifeAge >= particle.lifetime || particle.x < -220 || particle.x > width + 220 || particle.y > height + 220) resetParticle(particle, false);
            drawParticle(particle.layer === "foreground" ? foreground : background, particle);
          }
          frameRequest = requestAnimationFrame(render);
        } catch (error) {
          fail(error);
        }
      }
      function start() {
        cancelAnimationFrame(frameRequest);
        previousTime = 0;
        if (enabled && !destroyed && !document.hidden && atlas) frameRequest = requestAnimationFrame(render);
      }
      function loadImage(source) {
        return new Promise((resolve, reject) => {
          const image = new Image();
          image.addEventListener("load", () => resolve(image), { once: true });
          image.addEventListener("error", () => reject(new Error("特效贴图加载失败")), { once: true });
          image.src = source;
        });
      }
      async function syncTheme(date = new Date()) {
        const theme = themeForDate(date);
        if (theme === currentTheme) return;
        const request = ++themeRequest;
        const nextPackage = packages[theme];
        const nextAtlas = await loadImage(nextPackage.atlas);
        if (destroyed || request !== themeRequest) return;
        currentTheme = theme;
        manifest = nextPackage.manifest;
        atlas = nextAtlas;
        reconcileParticles();
        for (const particle of particles) resetParticle(particle, true);
        start();
      }

      const onResize = () => resize();
      const onVisibilityChange = () => start();
      addEventListener("resize", onResize);
      document.addEventListener("visibilitychange", onVisibilityChange);
      const themeTimer = setInterval(() => { void syncTheme().catch(fail); }, 60_000);
      const controller = {
        get enabled() { return enabled; },
        setEnabled(value) {
          enabled = Boolean(value);
          backgroundCanvas.hidden = !enabled;
          foregroundCanvas.hidden = !enabled;
          if (enabled) start();
          else {
            cancelAnimationFrame(frameRequest);
            clear(background);
            clear(foreground);
          }
        },
        destroy() {
          if (destroyed) return;
          destroyed = true;
          cancelAnimationFrame(frameRequest);
          clearInterval(themeTimer);
          removeEventListener("resize", onResize);
          document.removeEventListener("visibilitychange", onVisibilityChange);
          backgroundCanvas.remove();
          foregroundCanvas.remove();
          if (activeController === controller) activeController = null;
        },
      };
      activeController = controller;
      resize();
      try {
        await syncTheme();
        controller.setEnabled(enabled);
        return controller;
      } catch (error) {
        controller.destroy();
        throw error;
      }
    },
  });
})();
`;
}
