import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import * as fs from "node:fs";
import * as path from "node:path";
import { PNG } from "pngjs";
import type { ComputerAction } from "./types.js";
import type { DeviceConfig } from "./device-extractor.js";

const DEFAULT_VIEWPORT = { width: 1440, height: 900 };
const INTER_ACTION_DELAY_MS = 120;

export type BrowserSession = {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  close: () => Promise<void>;
};

// Singleton browser instance — stays alive across runs to avoid cold starts
let sharedBrowser: Browser | null = null;

async function getOrLaunchBrowser(): Promise<Browser> {
  if (sharedBrowser && sharedBrowser.isConnected()) {
    return sharedBrowser;
  }
  sharedBrowser = await chromium.launch({
    headless: true,
    args: [
      `--window-size=${DEFAULT_VIEWPORT.width},${DEFAULT_VIEWPORT.height}`,
      "--disable-blink-features=AutomationControlled",
    ],
  });
  return sharedBrowser;
}

export async function launchBrowser(device?: DeviceConfig): Promise<BrowserSession> {
  const browser = await getOrLaunchBrowser();

  const context = await browser.newContext({
    viewport: device?.viewport ?? DEFAULT_VIEWPORT,
    userAgent:
      device?.userAgent ??
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    // Always use deviceScaleFactor 1 so screenshots match CSS pixel coordinates.
    // The CUA model sends click coordinates based on screenshot dimensions,
    // but Playwright's click(x,y) operates in CSS pixel space.
    deviceScaleFactor: 1,
    isMobile: device?.isMobile ?? false,
    hasTouch: device?.hasTouch ?? false,
  });

  const page = await context.newPage();
  await page.goto("about:blank");

  return {
    browser,
    context,
    page,
    close: async () => {
      // Only close the context, keep the browser alive for the next run
      await context.close();
    },
  };
}

export type ScreenshotResult = {
  buffer: Buffer;
  path: string;
  dataUrl: string;
  url: string;
};

/** Draw a pink 50%-transparent halo and a mouse pointer on a PNG buffer.
 *  The centre of the halo (and tip of the arrow) is at (cx, cy). */
function drawCursorOnPng(pngBuf: Buffer, cx: number, cy: number): Buffer {
  const img = PNG.sync.read(pngBuf);
  const { width, height, data } = img;

  const setPixel = (px: number, py: number, r: number, g: number, b: number, a: number) => {
    if (px < 0 || py < 0 || px >= width || py >= height) return;
    const idx = (py * width + px) * 4;
    const srcA = a / 255;
    data[idx + 0] = Math.round(r * srcA + data[idx + 0] * (1 - srcA));
    data[idx + 1] = Math.round(g * srcA + data[idx + 1] * (1 - srcA));
    data[idx + 2] = Math.round(b * srcA + data[idx + 2] * (1 - srcA));
    data[idx + 3] = Math.max(data[idx + 3], a);
  };

  // --- Pink halo: 40px radius filled circle, 50% transparent ---
  const R = 40;
  const R2 = R * R;
  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      if (dx * dx + dy * dy <= R2) {
        // pink (255, 105, 180) at alpha 128 (~50%)
        setPixel(cx + dx, cy + dy, 255, 105, 180, 128);
      }
    }
  }

  // --- macOS-style arrow cursor, tip at (cx, cy) ---
  // Each row is [startCol, endCol] pairs defining filled spans.
  // 'B' = black fill, 'W' = white outline. Drawn at 2x scale.
  // Classic pointer: 12x19 template, rendered at 2x = 24x38
  const template: string[] = [
    "WB",
    "WBB",
    "WBBB",
    "WBBBB",
    "WBBBBB",
    "WBBBBBB",
    "WBBBBBBB",
    "WBBBBBBBB",
    "WBBBBBBBBB",
    "WBBBBBBBBBB",
    "WBBBBBBBBBBB",
    "WBBBBBBWWWWW",
    "WBBBBWW",
    "WBBBW",
    "WBBW",
    "WWW",
  ];
  const SCALE = 2;
  // Draw white outline first, then black fill
  for (const pass of ["outline", "fill"] as const) {
    for (let row = 0; row < template.length; row++) {
      for (let col = 0; col < template[row].length; col++) {
        const ch = template[row][col];
        if (ch === "S") continue; // skip / transparent
        if (pass === "outline" && ch === "W") {
          // White border pixels
          for (let sy = 0; sy < SCALE; sy++) {
            for (let sx = 0; sx < SCALE; sx++) {
              setPixel(cx + col * SCALE + sx, cy + row * SCALE + sy, 255, 255, 255, 255);
            }
          }
        } else if (pass === "fill" && ch === "B") {
          // Black fill pixels
          for (let sy = 0; sy < SCALE; sy++) {
            for (let sx = 0; sx < SCALE; sx++) {
              setPixel(cx + col * SCALE + sx, cy + row * SCALE + sy, 0, 0, 0, 255);
            }
          }
        }
      }
    }
  }

  return PNG.sync.write(img);
}

export async function captureScreenshot(
  page: Page,
  dir: string,
  label: string,
  runId: string,
  cursorPos?: { x: number; y: number },
): Promise<ScreenshotResult> {
  fs.mkdirSync(dir, { recursive: true });
  const filename = `${label}.png`;
  const filePath = path.join(dir, filename);
  let buffer: Buffer = Buffer.from(await page.screenshot({ type: "png" }));
  if (cursorPos && Number.isFinite(cursorPos.x) && Number.isFinite(cursorPos.y)) {
    buffer = drawCursorOnPng(buffer, Math.round(cursorPos.x), Math.round(cursorPos.y)) as Buffer;
  }
  fs.writeFileSync(filePath, buffer);
  const dataUrl = `data:image/png;base64,${buffer.toString("base64")}`;
  const url = `/api/run/${runId}/screenshots/${filename}`;
  return { buffer, path: filePath, dataUrl, url };
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason);
    }, { once: true });
  });
}

// ── Key normalization ──

const KEY_MAP: Record<string, string> = {
  ctrl: "Control",
  control: "Control",
  meta: "Meta",
  cmd: "Meta",
  command: "Meta",
  alt: "Alt",
  option: "Alt",
  shift: "Shift",
  enter: "Enter",
  return: "Enter",
  escape: "Escape",
  esc: "Escape",
  space: " ",
  tab: "Tab",
  backspace: "Backspace",
  delete: "Delete",
  del: "Delete",
  arrowup: "ArrowUp",
  arrowdown: "ArrowDown",
  arrowleft: "ArrowLeft",
  arrowright: "ArrowRight",
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
  home: "Home",
  end: "End",
  pageup: "PageUp",
  pagedown: "PageDown",
  f1: "F1",
  f2: "F2",
  f3: "F3",
  f4: "F4",
  f5: "F5",
  f6: "F6",
  f7: "F7",
  f8: "F8",
  f9: "F9",
  f10: "F10",
  f11: "F11",
  f12: "F12",
};

function normalizeKey(key: string): string {
  const lower = key.toLowerCase().trim();
  return KEY_MAP[lower] ?? key;
}

// ── Action execution ──

export async function executeAction(
  page: Page,
  action: ComputerAction,
  signal?: AbortSignal,
): Promise<string> {
  const x = Number(action.x ?? 0);
  const y = Number(action.y ?? 0);
  const buttonValue = action.button;
  const button =
    buttonValue === "right" || buttonValue === 2 || buttonValue === 3
      ? "right"
      : buttonValue === "middle" || buttonValue === "wheel"
        ? "middle"
        : "left";

  let description: string;

  switch (action.type) {
    case "click": {
      await page.mouse.click(x, y, { button });
      description = `click(${x}, ${y}, ${button})`;
      break;
    }
    case "double_click": {
      await page.mouse.dblclick(x, y, { button });
      description = `double_click(${x}, ${y})`;
      break;
    }
    case "type": {
      const text = String(action.text ?? "");
      await page.keyboard.type(text);
      description = `type("${text.length > 50 ? text.slice(0, 50) + "..." : text}")`;
      break;
    }
    case "keypress": {
      const rawKeys = Array.isArray(action.keys)
        ? action.keys.map((k) => String(k))
        : [String(action.key ?? "")];
      const keys = rawKeys.map((k) => normalizeKey(k)).filter(Boolean);
      if (keys.length === 0) throw new Error("keypress action missing key");
      await page.keyboard.press(keys.join("+"));
      description = `keypress(${rawKeys.join("+")})`;
      break;
    }
    case "scroll": {
      if (Number.isFinite(x) && Number.isFinite(y)) {
        await page.mouse.move(x, y);
      }
      const dx = Number(action.delta_x ?? action.deltaX ?? 0);
      const dy = Number(action.delta_y ?? action.deltaY ?? action.scroll_y ?? 0);
      await page.mouse.wheel(dx, dy);
      description = `scroll(${dx}, ${dy})`;
      break;
    }
    case "drag": {
      const pathPoints = Array.isArray(action.path)
        ? action.path
            .map((p) =>
              p && typeof p === "object" && "x" in p && "y" in p
                ? { x: Number(p.x), y: Number(p.y) }
                : null,
            )
            .filter((p): p is { x: number; y: number } => p !== null)
        : [];
      if (pathPoints.length < 2) throw new Error("drag requires at least 2 path points");
      await page.mouse.move(pathPoints[0].x, pathPoints[0].y);
      await page.mouse.down();
      for (const point of pathPoints.slice(1)) {
        await page.mouse.move(point.x, point.y);
      }
      await page.mouse.up();
      description = `drag(${pathPoints.map((p) => `${p.x},${p.y}`).join(" → ")})`;
      break;
    }
    case "move": {
      await page.mouse.move(x, y);
      description = `move(${x}, ${y})`;
      break;
    }
    case "wait": {
      const ms = Number(action.ms ?? action.duration_ms ?? 1000);
      await delay(Math.max(0, ms), signal);
      description = `wait(${ms}ms)`;
      break;
    }
    case "screenshot": {
      description = "screenshot()";
      break;
    }
    default: {
      throw new Error(`Unsupported action type: ${action.type}`);
    }
  }

  // Inter-action delay (skip for wait/screenshot)
  if (action.type !== "wait" && action.type !== "screenshot") {
    await delay(INTER_ACTION_DELAY_MS, signal);
  }

  return description;
}
