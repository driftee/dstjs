import { Buffer } from "node:buffer";
import { constants } from "node:fs";
import {
  access,
  chmod,
  copyFile,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

import sharp from "sharp";

import { openAnimationBundle, openBuildBundle } from "../dist/animation/index.js";
import { decodeKtex, encodeKtexRgba } from "../dist/texture/index.js";

const run = promisify(execFile);
const gameArchive = path.join(
  process.env.HOME,
  "Library/Application Support/Steam/steamapps/common/Don't Starve Together",
  "dontstarve_steam.app/Contents/data/anim/fence.zip",
);
const backupArchive = `${gameArchive}.codex-facing-backup`;
const stagingArchive = `${gameArchive}.codex-facing-new`;
const command = process.argv[2] ?? "status";

if (command === "apply") {
  await applyMarkers(false);
} else if (command === "reapply") {
  await applyMarkers(true);
} else if (command === "restore") {
  await restoreBackup();
} else if (command === "status") {
  await printStatus();
} else {
  throw new Error(`未知命令 ${command}，请使用 apply、reapply、restore 或 status`);
}

async function applyMarkers(reuseBackup) {
  const backupExists = await exists(backupArchive);
  if (backupExists && !reuseBackup) {
    throw new Error(`备份已存在，拒绝覆盖：${backupArchive}`);
  }

  const sourceMode = (await stat(gameArchive)).mode;
  if (!backupExists) {
    await copyFile(gameArchive, backupArchive, constants.COPYFILE_EXCL);
    await chmod(backupArchive, sourceMode);
  }

  const workDirectory = await mkdtemp(path.join(tmpdir(), "dst-fence-facing-"));
  try {
    await run("/usr/bin/unzip", ["-q", backupArchive, "-d", workDirectory]);
    const atlasPath = path.join(workDirectory, "atlas-0.tex");
    await markAtlas(atlasPath);
    await run("/usr/bin/zip", [
      "-X",
      "-q",
      "-9",
      stagingArchive,
      "anim.bin",
      "atlas-0.tex",
      "build.bin",
    ], { cwd: workDirectory });

    await verifyArchive(stagingArchive);
    await chmod(stagingArchive, sourceMode);
    await rename(stagingArchive, gameArchive);
  } catch (error) {
    await rm(stagingArchive, { force: true });
    throw error;
  } finally {
    await rm(workDirectory, { recursive: true, force: true });
  }

  process.stdout.write(`已修改：${gameArchive}\n`);
  process.stdout.write(`原始备份：${backupArchive}\n`);
}

async function restoreBackup() {
  if (!await exists(backupArchive)) {
    throw new Error(`找不到备份：${backupArchive}`);
  }
  const sourceMode = (await stat(backupArchive)).mode;
  await copyFile(backupArchive, stagingArchive);
  await chmod(stagingArchive, sourceMode);
  await verifyArchive(stagingArchive);
  await rename(stagingArchive, gameArchive);
  process.stdout.write(`已恢复：${gameArchive}\n`);
  process.stdout.write(`保留备份：${backupArchive}\n`);
}

async function printStatus() {
  process.stdout.write(`游戏资源：${await describe(gameArchive)}\n`);
  process.stdout.write(`原始备份：${await describe(backupArchive)}\n`);
}

async function markAtlas(atlasPath) {
  const bundle = await openBuildBundle(backupArchive);
  const atlas = decodeKtex(await readFile(atlasPath));
  const symbol = bundle.build.symbols.find(candidate => candidate.name === "fence_posts_thin");
  if (!symbol) throw new Error("fence build 中找不到 fence_posts_thin");

  const labels = new Map([
    [0, "0/2"],
    [2, "4/5"],
    [4, "3/1"],
    [6, "6/7"],
    [8, "8"],
  ]);
  const composites = [];
  for (const frame of symbol.frames) {
    const label = labels.get(frame.frameNumber);
    if (!label) continue;
    const minU = Math.min(...frame.vertices.map(vertex => vertex.u));
    const maxU = Math.max(...frame.vertices.map(vertex => vertex.u));
    const maxV = Math.max(...frame.vertices.map(vertex => vertex.v));
    const left = Math.floor(minU * atlas.width) + 4;
    const top = Math.floor((1 - maxV) * atlas.height) + 64;
    const regionWidth = Math.ceil((maxU - minU) * atlas.width) - 8;
    const badgeWidth = Math.max(54, Math.min(82, regionWidth));
    const badgeHeight = 34;
    composites.push({
      input: createBadge(label, badgeWidth, badgeHeight),
      left,
      top,
    });
    process.stdout.write(`build frame ${frame.frameNumber}: ${label} @ ${left},${top}\n`);
  }

  const rgba = await sharp(atlas.rgba, {
    raw: { width: atlas.width, height: atlas.height, channels: 4 },
  }).composite(composites).raw().toBuffer();
  await writeFile(atlasPath, encodeKtexRgba({
    width: atlas.width,
    height: atlas.height,
    rgba,
  }));
}

function createBadge(label, width, height) {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`
    + `<rect width="${width}" height="${height}" rx="3" fill="#b91c1c"/>`
    + `<rect width="7" height="${height}" fill="#22d3ee"/>`
    + `<text x="${width / 2 + 3}" y="18" dominant-baseline="middle" text-anchor="middle"`
    + ` font-family="Arial,sans-serif" font-size="23" font-weight="700" fill="white">${label}</text>`
    + "</svg>",
  );
}

async function verifyArchive(filename) {
  await run("/usr/bin/unzip", ["-tq", filename]);
  const bundle = await openAnimationBundle(filename);
  const atlas = bundle.atlases.get("atlas-0.tex");
  if (!atlas || atlas.width !== 1024 || atlas.height !== 1024) {
    throw new Error("修改后的 fence atlas 无效");
  }
  process.stdout.write(
    `验证通过：${bundle.build.name} ${atlas.width}x${atlas.height} ${atlas.compression}\n`,
  );
}

async function describe(filename) {
  if (!await exists(filename)) return "不存在";
  const metadata = await stat(filename);
  return `${filename} (${metadata.size} bytes)`;
}

async function exists(filename) {
  try {
    await access(filename);
    return true;
  } catch {
    return false;
  }
}
