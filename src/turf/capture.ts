import { execFile } from "node:child_process";
import { mkdir, open, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const CAPTURE_READY_MARKER = /\[DSTJS_TURF_CAPTURE]\s+event=capture_ready\s+mask=(\d{1,3})/;
const COMPLETE_MARKER = /\[DSTJS_TURF_CALIBRATION]\s+event=complete\s+masks=256/;
const COAST_READY_MARKER = /\[DSTJS_COAST_CAPTURE]\s+event=capture_ready\s+case=([a-z_]+)\s+case_index=(\d+)\s+view=(top|angled)\s+pitch=([\d.]+)\s+distance=([\d.]+)\s+fov=([\d.]+)\s+heading=([-\d.]+)/;
const COAST_COMPLETE_MARKER = /\[DSTJS_COAST_CALIBRATION]\s+event=complete\s+cases=(\d+)\s+views=(\d+)/;

export type TurfCaptureEvent =
  | { type: "ready"; mask: number }
  | { type: "complete" };

export type WindowBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type TurfCaptureRun = {
  format: "dstjs-turf-capture-run:v1";
  logPath: string;
  startedAt: string;
  completed: boolean;
  captures: Array<{ mask: number; file: string; capturedAt: string }>;
  failures: Array<{ mask: number; reason: string }>;
};

export type CoastCaptureRun = {
  format: "dstjs-coast-capture-run:v1";
  logPath: string;
  startedAt: string;
  completed: boolean;
  captures: Array<{
    case: string;
    caseIndex: number;
    view: "top" | "angled";
    pitch: number;
    distance: number;
    fov: number;
    heading: number;
    file: string;
    capturedAt: string;
  }>;
  failures: Array<{ case: string; view: "top" | "angled"; reason: string }>;
};

export class TurfCaptureLogDecoder {
  private pending = "";

  push(chunk: string): TurfCaptureEvent[] {
    const lines = `${this.pending}${chunk}`.split(/\r?\n/);
    this.pending = lines.pop() ?? "";
    return lines.flatMap(parseTurfCaptureLine);
  }

  reset(): void {
    this.pending = "";
  }
}

export function parseTurfCaptureLine(line: string): TurfCaptureEvent[] {
  if (COMPLETE_MARKER.test(line)) return [{ type: "complete" }];
  const match = CAPTURE_READY_MARKER.exec(line);
  if (!match) return [];
  const mask = Number(match[1]);
  return mask <= 255 ? [{ type: "ready", mask }] : [];
}

export function parseWindowBounds(output: string): WindowBounds {
  const values = output.trim().split(/\s*,\s*/).map(Number);
  const [x, y, width, height] = values;
  if (values.length !== 4 || [x, y, width, height].some((value) => !Number.isFinite(value))) {
    throw new Error(`无法解析 DST 窗口范围：${output.trim()}`);
  }
  if (width === undefined || height === undefined || x === undefined || y === undefined || width < 1 || height < 1) {
    throw new Error(`DST 窗口范围无效：${output.trim()}`);
  }
  return { x, y, width, height };
}

export async function captureTurfCalibration(options: {
  logPath: string;
  outputDirectory: string;
  signal?: AbortSignal;
  pollMilliseconds?: number;
}): Promise<TurfCaptureRun> {
  if (process.platform !== "darwin") {
    throw new Error("当前自动截图采集器仅支持 macOS");
  }
  const logPath = path.resolve(options.logPath);
  const outputDirectory = path.resolve(options.outputDirectory);
  const manifestPath = path.join(outputDirectory, "capture-run.json");
  await mkdir(outputDirectory, { recursive: true });
  let offset = (await stat(logPath)).size;
  let bounds: WindowBounds | null = await findDontStarveWindow();
  const decoder = new TurfCaptureLogDecoder();
  const captures = new Map<number, TurfCaptureRun["captures"][number]>();
  const failures = new Map<number, TurfCaptureRun["failures"][number]>();
  const run: TurfCaptureRun = {
    format: "dstjs-turf-capture-run:v1",
    logPath,
    startedAt: new Date().toISOString(),
    completed: false,
    captures: [],
    failures: [],
  };

  const saveManifest = async (): Promise<void> => {
    run.captures = [...captures.values()].sort((left, right) => left.mask - right.mask);
    run.failures = [...failures.values()].sort((left, right) => left.mask - right.mask);
    await writeFile(manifestPath, `${JSON.stringify(run, null, 2)}\n`, "utf8");
  };

  await saveManifest();
  console.log(`已定位 DST 窗口：${bounds.x},${bounds.y} ${bounds.width}x${bounds.height}`);
  console.log(`等待捕获事件：${logPath}`);
  console.log("请切回 DST 并点击 Auto；采集期间保持游戏窗口位于前台。按 Ctrl+C 停止。");

  while (!options.signal?.aborted && !run.completed) {
    await delay(options.pollMilliseconds ?? 75);
    const size = (await stat(logPath)).size;
    if (size < offset) {
      offset = 0;
      decoder.reset();
    }
    if (size === offset) continue;
    const length = size - offset;
    const buffer = Buffer.alloc(length);
    const file = await open(logPath, "r");
    try {
      await file.read(buffer, 0, length, offset);
    } finally {
      await file.close();
    }
    offset = size;

    for (const event of decoder.push(buffer.toString("utf8"))) {
      if (event.type === "complete") {
        run.completed = true;
        break;
      }
      const outputFile = path.join(outputDirectory, `mask-${event.mask.toString().padStart(3, "0")}.png`);
      try {
        bounds ??= await findDontStarveWindow();
        await captureWindow(bounds, outputFile);
        captures.set(event.mask, {
          mask: event.mask,
          file: path.basename(outputFile),
          capturedAt: new Date().toISOString(),
        });
        failures.delete(event.mask);
        console.log(`[${event.mask.toString().padStart(3, "0")}/255] ${outputFile}`);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        failures.set(event.mask, { mask: event.mask, reason });
        bounds = null;
        console.error(`[${event.mask.toString().padStart(3, "0")}/255] 截图失败：${reason}`);
      }
      await saveManifest();
    }
  }

  await saveManifest();
  return run;
}

export async function captureCoastCalibration(options: {
  logPath: string;
  outputDirectory: string;
  signal?: AbortSignal;
  pollMilliseconds?: number;
}): Promise<CoastCaptureRun> {
  if (process.platform !== "darwin") throw new Error("当前自动截图采集器仅支持 macOS");
  const logPath = path.resolve(options.logPath);
  const outputDirectory = path.resolve(options.outputDirectory);
  const manifestPath = path.join(outputDirectory, "coast-capture-run.json");
  await mkdir(outputDirectory, { recursive: true });
  let offset = (await stat(logPath)).size;
  let bounds: WindowBounds | null = null;
  try {
    bounds = await findDontStarveWindow();
  } catch {
    // The collector may start before the game. Resolve the window on the first capture event.
  }
  let pending = "";
  const captures = new Map<string, CoastCaptureRun["captures"][number]>();
  const failures = new Map<string, CoastCaptureRun["failures"][number]>();
  const run: CoastCaptureRun = {
    format: "dstjs-coast-capture-run:v1",
    logPath,
    startedAt: new Date().toISOString(),
    completed: false,
    captures: [],
    failures: [],
  };
  const save = async () => {
    run.captures = [...captures.values()].sort((left, right) =>
      left.caseIndex - right.caseIndex || left.view.localeCompare(right.view));
    run.failures = [...failures.values()];
    await writeFile(manifestPath, `${JSON.stringify(run, null, 2)}\n`, "utf8");
  };
  await save();
  if (bounds) console.log(`已定位 DST 窗口：${bounds.x},${bounds.y} ${bounds.width}x${bounds.height}`);
  else console.log("DST 尚未启动；将在首个海岸捕获事件到达时定位窗口。");
  console.log("等待 Coast Auto 捕获事件；采集期间保持 DST 窗口位于前台。按 Ctrl+C 停止。");

  while (!options.signal?.aborted && !run.completed) {
    await delay(options.pollMilliseconds ?? 75);
    const size = (await stat(logPath)).size;
    if (size < offset) {
      offset = 0;
      pending = "";
    }
    if (size === offset) continue;
    const buffer = Buffer.alloc(size - offset);
    const file = await open(logPath, "r");
    try {
      await file.read(buffer, 0, buffer.length, offset);
    } finally {
      await file.close();
    }
    offset = size;
    const lines = `${pending}${buffer.toString("utf8")}`.split(/\r?\n/);
    pending = lines.pop() ?? "";
    for (const line of lines) {
      if (COAST_COMPLETE_MARKER.test(line)) {
        run.completed = true;
        break;
      }
      const match = COAST_READY_MARKER.exec(line);
      if (!match) continue;
      const [, caseName, caseIndexText, viewText, pitchText, distanceText, fovText, headingText] = match;
      if (!caseName || !caseIndexText || (viewText !== "top" && viewText !== "angled")) continue;
      const key = `${caseName}:${viewText}`;
      const outputFile = path.join(outputDirectory, `${caseName}-${viewText}.png`);
      try {
        await delay(300);
        bounds = await findDontStarveWindow();
        await captureWindow(bounds, outputFile);
        captures.set(key, {
          case: caseName,
          caseIndex: Number(caseIndexText),
          view: viewText,
          pitch: Number(pitchText),
          distance: Number(distanceText),
          fov: Number(fovText),
          heading: Number(headingText),
          file: path.basename(outputFile),
          capturedAt: new Date().toISOString(),
        });
        // #region debug-point E:native-coast-capture
        if (process.env.DEBUG_SERVER_URL) fetch(process.env.DEBUG_SERVER_URL,{method:"POST",body:JSON.stringify({sessionId:process.env.DEBUG_SESSION_ID??"coast-mesh-mismatch",runId:"native-reference",hypothesisId:"E",location:"src/turf/capture.ts:captureCoastCalibration",msg:"[DEBUG] Native coastline frame captured",data:captures.get(key),ts:Date.now()})}).catch(()=>{});
        // #endregion
        failures.delete(key);
        console.log(`[${captures.size}/12] ${outputFile}`);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        failures.set(key, { case: caseName, view: viewText, reason });
        bounds = null;
        console.error(`[${key}] 截图失败：${reason}`);
      }
      await save();
    }
  }
  await save();
  return run;
}

async function findDontStarveWindow(): Promise<WindowBounds> {
  const script = `
tell application "System Events"
    set targetProcess to missing value
    repeat with candidate in application processes
        set candidateName to name of candidate as text
        ignoring case
            if candidateName contains "dontstarve" or candidateName contains "don't starve together" then
                set targetProcess to candidate
                exit repeat
            end if
        end ignoring
    end repeat
    if targetProcess is missing value then error "DST process not found"
    tell targetProcess
        if (count of windows) is 0 then error "DST window not found"
        set windowPosition to position of front window
        set windowSize to size of front window
    end tell
    return (item 1 of windowPosition as text) & "," & (item 2 of windowPosition as text) & "," & (item 1 of windowSize as text) & "," & (item 2 of windowSize as text)
end tell`;
  try {
    const { stdout } = await execFileAsync("osascript", ["-e", script], {
      encoding: "utf8",
      timeout: 3_000,
    });
    return parseWindowBounds(stdout);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`无法读取 DST 窗口位置；请为运行 dstjs 的终端开启“辅助功能”权限。${reason}`);
  }
}

async function captureWindow(bounds: WindowBounds, outputFile: string): Promise<void> {
  const rectangle = `${bounds.x},${bounds.y},${bounds.width},${bounds.height}`;
  try {
    await execFileAsync("screencapture", ["-x", "-o", `-R${rectangle}`, outputFile], { timeout: 3_000 });
    const result = await stat(outputFile);
    if (result.size === 0) throw new Error("截图文件为空");
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`macOS 截图失败；请开启“屏幕与系统音频录制”权限。${reason}`);
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
