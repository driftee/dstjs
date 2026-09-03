import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

import { parseAtlasXml, uvToRectangle } from "../atlas/xml.js";
import { decodeKtex } from "../texture/ktex.js";
import type { TurfNativeLookupReport } from "./recognition.js";

type TurfSource = {
  key: string;
  label: string;
  atlas: string;
  noise: string;
  color: string;
};

type BrowserTurf = {
  key: string;
  label: string;
  atlas: string;
  noise: string;
  color: string;
  elements: Record<string, { left: number; top: number; width: number; height: number }>;
};

export type TurfSimulatorOptions = {
  dataDirectory: string;
  outputDirectory: string;
  mapping: TurfNativeLookupReport;
};

export const CALIBRATION_SCREEN_VECTORS = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
] as const;

export const GROUND_DETAIL_OPACITY = 0.62;

const TURF_SOURCES: TurfSource[] = [
  { key: "rocky", label: "岩石地皮", atlas: "rocky", noise: "noise_rocky", color: "#77705f" },
  { key: "savanna", label: "热带草原", atlas: "yellowgrass", noise: "Ground_noise_grass_detail", color: "#b59a45" },
  { key: "forest", label: "森林地皮", atlas: "forest", noise: "Ground_noise", color: "#3d5032" },
  { key: "grass", label: "长青地皮", atlas: "grass", noise: "Ground_noise", color: "#577443" },
  { key: "dirt", label: "泥土地皮", atlas: "dirt", noise: "Ground_noise_dirt", color: "#806c4e" },
];

export async function writeTurfSimulator(options: TurfSimulatorOptions): Promise<void> {
  const dataDirectory = path.resolve(options.dataDirectory);
  const outputDirectory = path.resolve(options.outputDirectory);
  const assetsDirectory = path.join(outputDirectory, "assets");
  await mkdir(assetsDirectory, { recursive: true });

  const turfs = await Promise.all(TURF_SOURCES.map(async (source) => {
    const atlasXmlPath = path.join(dataDirectory, "levels", "tiles", `${source.atlas}.xml`);
    const atlasTexturePath = path.join(dataDirectory, "levels", "tiles", `${source.atlas}.tex`);
    const noiseTexturePath = path.join(dataDirectory, "levels", "textures", `${source.noise}.tex`);
    const [xml, atlasTexture, noiseTexture] = await Promise.all([
      readFile(atlasXmlPath, "utf8"),
      readFile(atlasTexturePath),
      readFile(noiseTexturePath),
    ]);
    const atlas = decodeKtex(atlasTexture);
    const noise = decodeKtex(noiseTexture);
    const atlasFilename = `${source.key}-atlas.png`;
    const noiseFilename = `${source.key}-noise.png`;
    await Promise.all([
      writeDecodedPng(path.join(assetsDirectory, atlasFilename), atlas),
      writeDecodedPng(path.join(assetsDirectory, noiseFilename), noise),
    ]);
    const elements: BrowserTurf["elements"] = {};
    for (const sheet of parseAtlasXml(xml)) {
      for (const element of sheet.elements) {
        if (elements[element.name]) continue;
        elements[element.name] = uvToRectangle(element, atlas.width, atlas.height);
      }
    }
    return {
      key: source.key,
      label: source.label,
      atlas: `assets/${atlasFilename}`,
      noise: `assets/${noiseFilename}`,
      color: source.color,
      elements,
    };
  }));

  await writeFile(path.join(outputDirectory, "index.html"), createTurfSimulatorHtml({
    mapping: options.mapping,
    turfs,
  }), "utf8");
}

export function createTurfSimulatorHtml(input: { mapping: TurfNativeLookupReport; turfs: BrowserTurf[] }): string {
  const data = JSON.stringify(input).replaceAll("<", "\\u003c");
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>DST.js 地皮模拟器</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; --zoom: .86; --rotation: -45deg; }
    * { box-sizing: border-box; }
    html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; }
    body { background: #151810; color: #f3ead3; user-select: none; }
    .stage { position: fixed; inset: 0; overflow: hidden; background: radial-gradient(ellipse at 50% 48%, #334029 0, #1d2519 48%, #0e110c 100%); }
    .stage::after { position: absolute; inset: 0; pointer-events: none; background: linear-gradient(180deg, rgba(255,235,181,.08), transparent 28%, rgba(0,0,0,.25)); content: ""; }
    #world { position: absolute; z-index: 1; top: 49%; left: 52%; width: min(112vmax, 1450px); height: min(112vmax, 1450px); cursor: crosshair; image-rendering: auto; transform: translate(-50%, -50%) perspective(1100px) rotateX(57deg) rotateZ(var(--rotation)) scale(var(--zoom)); transform-origin: 50% 50%; transition: transform .35s ease; }
    body.topdown #world { top: 50%; left: 50%; width: min(92vmin, 960px); height: min(92vmin, 960px); transform: translate(-50%, -50%) rotateZ(var(--rotation)) scale(var(--zoom)); }
    .brand { position: fixed; z-index: 3; top: 22px; left: 24px; pointer-events: none; text-shadow: 0 2px 12px #000; }
    .brand small { color: #cfbb87; font-size: 10px; font-weight: 800; letter-spacing: .18em; text-transform: uppercase; }
    .brand h1 { margin: 4px 0 0; font-family: Georgia, "Times New Roman", serif; font-size: clamp(25px, 4vw, 43px); font-weight: 400; letter-spacing: -.035em; }
    .panel { position: fixed; z-index: 4; top: 94px; left: 20px; width: 224px; padding: 14px; border: 1px solid rgba(235,214,160,.18); border-radius: 14px; background: rgba(23,25,18,.87); box-shadow: 0 18px 48px rgba(0,0,0,.34); backdrop-filter: blur(14px); }
    .panel-title { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 10px; color: #cfbb87; font-size: 11px; }
    #palette { display: grid; gap: 7px; }
    .turf-row { display: grid; grid-template-columns: 1fr 28px 28px; gap: 5px; }
    .turf, .rank { min-height: 38px; border: 1px solid rgba(235,214,160,.12); border-radius: 8px; background: rgba(255,255,255,.045); color: #eee3ca; cursor: pointer; }
    .turf { display: flex; align-items: center; gap: 9px; padding: 0 10px; text-align: left; }
    .turf[aria-pressed="true"] { border-color: #d8bd72; background: rgba(216,189,114,.16); }
    .swatch { width: 15px; height: 15px; flex: 0 0 auto; border: 1px solid rgba(255,255,255,.2); border-radius: 3px; background: var(--swatch); }
    .rank { padding: 0; color: #b9aa85; font-size: 13px; }
    button:hover { filter: brightness(1.14); }
    button:focus-visible { outline: 3px solid rgba(216,189,114,.34); outline-offset: 2px; }
    .panel-note { margin: 11px 1px 0; color: rgba(238,227,202,.55); font-size: 10px; line-height: 1.5; }
    .tools { position: fixed; z-index: 4; top: 18px; right: 18px; display: flex; gap: 8px; }
    .tools button { min-height: 38px; padding: 0 13px; border: 1px solid rgba(235,214,160,.16); border-radius: 9px; background: rgba(23,25,18,.84); color: #eee3ca; cursor: pointer; backdrop-filter: blur(12px); }
    #status { position: fixed; z-index: 4; right: 18px; bottom: 16px; max-width: calc(100vw - 36px); padding: 8px 11px; border-radius: 8px; background: rgba(16,18,13,.74); color: rgba(238,227,202,.72); font-size: 11px; pointer-events: none; }
    .loading { cursor: progress; }
    @media (max-width: 650px) {
      .brand { top: 14px; left: 14px; }
      .panel { top: auto; right: 12px; bottom: 48px; left: 12px; width: auto; }
      #palette { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .turf-row { grid-template-columns: 1fr; }
      .rank { display: none; }
      .panel-note { display: none; }
      .tools { top: 12px; right: 12px; }
    }
  </style>
</head>
<body class="loading">
  <main class="stage"><canvas id="world" width="1344" height="1344" aria-label="可编辑地皮地图"></canvas></main>
  <header class="brand"><small>DST.js · Native turf lab</small><h1>地皮模拟器</h1></header>
  <aside class="panel">
    <div class="panel-title"><span>地皮与覆盖顺序</span><span>上层优先</span></div>
    <div id="palette"></div>
    <p class="panel-note">点击或拖动铺设地皮；箭头用于调整覆盖顺序。滚轮缩放视角。</p>
  </aside>
  <nav class="tools" aria-label="视图工具">
    <button id="view" type="button">俯视调试</button>
    <button id="reset" type="button">重置布局</button>
  </nav>
  <output id="status">正在解析原版地皮资源…</output>
  <script id="simulator-data" type="application/json">${data}</script>
  <script>
    (() => {
      "use strict";
      const data = JSON.parse(document.getElementById("simulator-data").textContent);
      const canvas = document.getElementById("world");
      const context = canvas.getContext("2d");
      const detailCanvas = document.createElement("canvas");
      const detailContext = detailCanvas.getContext("2d");
      const palette = document.getElementById("palette");
      const status = document.getElementById("status");
      const viewButton = document.getElementById("view");
      const resetButton = document.getElementById("reset");
      const gridSize = 14;
      const tileSize = canvas.width / gridSize;
      detailCanvas.width = tileSize;
      detailCanvas.height = tileSize;
      // Native lookup bits are world-space N, NE, E, SE, S, SW, W, NW.
      // With the calibration camera locked at heading 0, world north points to
      // atlas/screen right, so rotate the sampling vectors clockwise once.
      const vectors = ${JSON.stringify(CALIBRATION_SCREEN_VECTORS)};
      const atlasImages = new Map();
      const noiseImages = new Map();
      let order = data.turfs.map((turf) => turf.key);
      let selected = "grass";
      let map = new Array(gridSize * gridSize).fill("dirt");
      let painting = false;
      let topdown = false;
      let zoom = .86;
      let rotation = -45;

      function index(x, y) { return y * gridSize + x; }
      function inside(x, y) { return x >= 0 && y >= 0 && x < gridSize && y < gridSize; }
      function turfByKey(key) { return data.turfs.find((turf) => turf.key === key); }
      function rank(key) { return order.indexOf(key); }
      function elementRect(turf, element) { return turf.elements[String(element).padStart(2, "0")] || turf.elements["01"]; }
      function drawElement(turf, element, x, y) {
        const rect = elementRect(turf, element);
        const image = atlasImages.get(turf.key);
        if (!rect || !image) return;
        context.save();
        context.translate(x * tileSize, (y + 1) * tileSize);
        context.scale(1, -1);
        context.drawImage(image, rect.left, rect.top, rect.width, rect.height, 0, 0, tileSize, tileSize);
        context.restore();
        drawElementDetail(turf, rect, image, x, y);
      }
      function drawElementDetail(turf, rect, atlasImage, x, y) {
        const noise = noiseImages.get(turf.key);
        if (!noise) return;
        detailContext.clearRect(0, 0, tileSize, tileSize);
        detailContext.globalAlpha = 1;
        detailContext.globalCompositeOperation = "source-over";
        const startX = -((x * tileSize) % noise.width);
        const startY = -((y * tileSize) % noise.height);
        for (let py = startY; py < tileSize; py += noise.height) {
          for (let px = startX; px < tileSize; px += noise.width) detailContext.drawImage(noise, px, py);
        }
        detailContext.globalCompositeOperation = "destination-in";
        detailContext.save();
        detailContext.translate(0, tileSize);
        detailContext.scale(1, -1);
        detailContext.drawImage(atlasImage, rect.left, rect.top, rect.width, rect.height, 0, 0, tileSize, tileSize);
        detailContext.restore();
        context.save();
        context.globalAlpha = ${GROUND_DETAIL_OPACITY};
        context.globalCompositeOperation = "multiply";
        context.drawImage(detailCanvas, x * tileSize, y * tileSize);
        context.restore();
      }
      function render() {
        context.clearRect(0, 0, canvas.width, canvas.height);
        for (let y = 0; y < gridSize; y += 1) {
          for (let x = 0; x < gridSize; x += 1) {
            const turf = turfByKey(map[index(x, y)]);
            context.fillStyle = turf.color;
            context.fillRect(x * tileSize, y * tileSize, tileSize, tileSize);
            drawElement(turf, 1, x, y);
          }
        }
        for (const key of order) {
          const turf = turfByKey(key);
          for (let y = 0; y < gridSize; y += 1) {
            for (let x = 0; x < gridSize; x += 1) {
              const targetKey = map[index(x, y)];
              if (targetKey === key || rank(key) <= rank(targetKey)) continue;
              let mask = 0;
              vectors.forEach(([dx, dy], bit) => {
                if (inside(x + dx, y + dy) && map[index(x + dx, y + dy)] === key) mask |= 1 << bit;
              });
              const element = data.mapping.elements[mask] || 0;
              if (element > 0) drawElement(turf, element, x, y);
            }
          }
        }
      }
      function seed() {
        map.fill("dirt");
        for (let y = 2; y < 9; y += 1) for (let x = 1; x < 7; x += 1) map[index(x, y)] = "forest";
        for (let y = 5; y < 13; y += 1) for (let x = 5; x < 12; x += 1) if ((x + y) % 7 !== 0) map[index(x, y)] = "grass";
        for (let y = 1; y < 6; y += 1) for (let x = 8; x < 13; x += 1) if (x - y < 10) map[index(x, y)] = "savanna";
        [[2,10],[3,10],[3,11],[4,11],[4,12],[9,9],[10,9]].forEach(([x,y]) => { map[index(x,y)] = "rocky"; });
      }
      function buildPalette() {
        palette.replaceChildren();
        [...order].reverse().forEach((key) => {
          const turf = turfByKey(key);
          const row = document.createElement("div");
          row.className = "turf-row";
          const choose = document.createElement("button");
          choose.type = "button";
          choose.className = "turf";
          choose.setAttribute("aria-pressed", String(selected === key));
          choose.innerHTML = '<span class="swatch" style="--swatch:' + turf.color + '"></span><span>' + turf.label + '</span>';
          choose.addEventListener("click", () => { selected = key; buildPalette(); updateStatus(); });
          const up = rankButton("↑", () => moveRank(key, 1), "提高覆盖优先级");
          const down = rankButton("↓", () => moveRank(key, -1), "降低覆盖优先级");
          row.append(choose, up, down);
          palette.append(row);
        });
      }
      function rankButton(text, action, label) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "rank";
        button.textContent = text;
        button.title = label;
        button.addEventListener("click", action);
        return button;
      }
      function moveRank(key, delta) {
        const from = rank(key);
        const to = Math.max(0, Math.min(order.length - 1, from + delta));
        if (from === to) return;
        order.splice(from, 1);
        order.splice(to, 0, key);
        buildPalette();
        render();
        updateStatus();
      }
      function updateStatus(cell) {
        const selectedTurf = turfByKey(selected);
        status.textContent = cell
          ? '格 (' + cell.x + ', ' + cell.y + ') · ' + turfByKey(map[index(cell.x, cell.y)]).label + ' → ' + selectedTurf.label
          : '当前画笔：' + selectedTurf.label + ' · 视角：' + (topdown ? '俯视调试' : '游戏斜视角') + ' · 朝向：' + ((rotation + 360) % 360) + '°';
      }
      function pointerCell(event) {
        const x = Math.floor(event.offsetX / canvas.clientWidth * gridSize);
        const y = Math.floor(event.offsetY / canvas.clientHeight * gridSize);
        return inside(x, y) ? { x, y } : null;
      }
      function paint(event) {
        const cell = pointerCell(event);
        if (!cell) return;
        const cellIndex = index(cell.x, cell.y);
        if (map[cellIndex] !== selected) {
          map[cellIndex] = selected;
          render();
        }
        updateStatus(cell);
      }
      function loadImage(source) {
        return new Promise((resolve, reject) => {
          const image = new Image();
          image.addEventListener("load", () => resolve(image), { once: true });
          image.addEventListener("error", () => reject(new Error('无法加载 ' + source)), { once: true });
          image.src = source;
        });
      }

      canvas.addEventListener("pointerdown", (event) => { painting = true; canvas.setPointerCapture(event.pointerId); paint(event); });
      canvas.addEventListener("pointermove", (event) => { const cell = pointerCell(event); if (painting) paint(event); else if (cell) updateStatus(cell); });
      canvas.addEventListener("pointerup", () => { painting = false; });
      canvas.addEventListener("pointercancel", () => { painting = false; });
      canvas.addEventListener("wheel", (event) => {
        event.preventDefault();
        zoom = Math.max(.58, Math.min(1.22, zoom - Math.sign(event.deltaY) * .05));
        document.documentElement.style.setProperty("--zoom", String(zoom));
      }, { passive: false });
      document.addEventListener("keydown", (event) => {
        if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
        const target = event.target;
        if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
        const key = event.key.toLowerCase();
        if (key !== "q" && key !== "e") return;
        event.preventDefault();
        rotation += key === "q" ? -45 : 45;
        document.documentElement.style.setProperty("--rotation", rotation + "deg");
        updateStatus();
      });
      viewButton.addEventListener("click", () => {
        topdown = !topdown;
        document.body.classList.toggle("topdown", topdown);
        viewButton.textContent = topdown ? "游戏视角" : "俯视调试";
        updateStatus();
      });
      resetButton.addEventListener("click", () => { seed(); render(); updateStatus(); });

      Promise.all(data.turfs.flatMap((turf) => [
        loadImage(turf.atlas).then((image) => atlasImages.set(turf.key, image)),
        loadImage(turf.noise).then((image) => noiseImages.set(turf.key, image)),
      ])).then(() => {
        seed();
        buildPalette();
        render();
        document.body.classList.remove("loading");
        updateStatus();
      }).catch((error) => { status.textContent = error.message; });
    })();
  </script>
</body>
</html>`;
}

async function writeDecodedPng(
  outputPath: string,
  texture: { width: number; height: number; rgba: Uint8Array },
): Promise<void> {
  const png = await sharp(Buffer.from(texture.rgba), {
    raw: { width: texture.width, height: texture.height, channels: 4 },
  }).png({ compressionLevel: 9 }).toBuffer();
  await writeFile(outputPath, png);
}
