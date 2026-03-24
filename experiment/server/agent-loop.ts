import * as fs from "node:fs";
import * as path from "node:path";
import { launchBrowser, captureScreenshot, executeAction, type BrowserSession } from "./browser.js";
import { callModel, buildToolOutputs, type FullModelResult } from "./openai.js";
import { isStuck } from "./stuck-detector.js";
import { generateRunVideo } from "./gif-generator.js";
import { extractDevice, type DeviceConfig } from "./device-extractor.js";
import type { Run, Turn, SSEEvent, Verdict } from "./types.js";

const SCREENSHOTS_BASE = path.join(process.cwd(), "screenshots");

// ── Mode toggle ──
// "compressed" = text summary for old turns + last turn structured (cheapest)
// "cheap"      = full structured history, old screenshots/reasoning stripped
// "stateful"   = previous_response_id, full history (most expensive)
const MODE: "compressed" | "cheap" | "stateful" = "compressed";

// How many recent screenshots to keep in the conversation history.
// Older computer_call_output items get a 1x1 transparent placeholder.
const MAX_SCREENSHOTS = 2;

// 1x1 white PNG — valid image used to replace old screenshots and save tokens
const PLACEHOLDER_IMG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC";

/**
 * Build the managed conversation history for cheap mode.
 * - Only keeps real screenshots in the last MAX_SCREENSHOTS entries
 * - Only keeps reasoning summaries in the last MAX_SCREENSHOTS entries
 * - Keeps ALL action/tool history (tiny tokens, valuable context)
 */
function buildCheapInput(
  conversationHistory: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  // Filter out internal markers first
  const items = conversationHistory.filter((item) => item.type !== "_page_context");

  // Find indices of screenshots and reasoning in the filtered array
  const screenshotIndices: number[] = [];
  const reasoningIndices: number[] = [];
  for (let i = 0; i < items.length; i++) {
    if (items[i].type === "computer_call_output") screenshotIndices.push(i);
    if (items[i].type === "reasoning") reasoningIndices.push(i);
  }

  const screenshotCutoff = screenshotIndices.length - MAX_SCREENSHOTS;
  const reasoningCutoff = reasoningIndices.length - MAX_SCREENSHOTS;

  return items.map((item, idx) => {
    // Strip old screenshots → placeholder
    if (item.type === "computer_call_output") {
      const rank = screenshotIndices.indexOf(idx);
      if (rank >= 0 && rank < screenshotCutoff) {
        return {
          ...item,
          output: {
            type: "computer_screenshot",
            image_url: PLACEHOLDER_IMG,
          },
        };
      }
    }

    // Strip old reasoning → empty summary
    if (item.type === "reasoning") {
      const rank = reasoningIndices.indexOf(idx);
      if (rank >= 0 && rank < reasoningCutoff) {
        return {
          ...item,
          summary: [],
        };
      }
    }

    return item;
  });
}

/**
 * Compressed mode: older turns become a text summary, only the last turn
 * keeps structured protocol items (computer_call + computer_call_output).
 */
function buildCompressedInput(
  conversationHistory: Array<Record<string, unknown>>,
  prompt: string,
): Array<Record<string, unknown>> {
  // Find the last computer_call_output (the boundary of the "last turn")
  let lastOutputIdx = -1;
  for (let i = conversationHistory.length - 1; i >= 0; i--) {
    if (conversationHistory[i].type === "computer_call_output" ||
        conversationHistory[i].type === "function_call_output") {
      lastOutputIdx = i;
      break;
    }
  }

  // Find the start of the last turn's structured items:
  // walk backwards from lastOutputIdx to find the reasoning/computer_call/function_call
  // Skip _page_context markers during the walk
  let lastTurnStart = lastOutputIdx;
  for (let i = lastOutputIdx - 1; i >= 0; i--) {
    const t = conversationHistory[i].type;
    if (t === "_page_context") continue; // skip our internal markers
    if (t === "reasoning" || t === "computer_call" || t === "function_call") {
      lastTurnStart = i;
    } else {
      break;
    }
  }

  // If not enough history for compression, fall back to cheap mode
  if (lastTurnStart <= 1) {
    return buildCheapInput(conversationHistory);
  }

  // Build text summary of actions + results + page context (no reasoning)
  const summaryLines: string[] = [];
  let pendingAction = "";
  for (let i = 1; i < lastTurnStart; i++) { // skip index 0 (user message)
    const item = conversationHistory[i];
    if (item.type === "computer_call") {
      const actions = item.actions as Array<Record<string, unknown>>;
      const actionStrs = actions.map((a) => {
        if (a.type === "screenshot") return "screenshot()";
        if (a.type === "click") return `click(${a.x},${a.y})`;
        if (a.type === "type") return `type("${String(a.text).slice(0, 40)}")`;
        if (a.type === "keypress") return `keypress(${(a.keys as string[]).join("+")})`;
        if (a.type === "scroll") return `scroll(${a.x},${a.y},${a.scroll_x},${a.scroll_y})`;
        if (a.type === "double_click") return `double_click(${a.x},${a.y})`;
        if (a.type === "wait") return `wait(${a.ms}ms)`;
        return String(a.type);
      });
      pendingAction = actionStrs.join(", ");
    } else if (item.type === "function_call") {
      const name = item.name as string;
      const args = item.arguments as string;
      pendingAction = `${name}(${args.slice(0, 60)})`;
    } else if (item.type === "function_call_output") {
      // Append result to pending action
      if (pendingAction) {
        pendingAction += ` → ${String(item.output).slice(0, 80)}`;
      }
    } else if (item.type === "_page_context") {
      // Flush pending action with page context
      const url = String(item.url || "").replace(/^https?:\/\//, "");
      const title = String(item.title || "");
      const ctx = title ? `${url} "${title}"` : url;
      if (pendingAction) {
        summaryLines.push(`${pendingAction} → ${ctx}`);
        pendingAction = "";
      }
    }
    // Skip reasoning and computer_call_output — not useful in summary
  }
  // Flush any remaining action without page context
  if (pendingAction) summaryLines.push(pendingAction);

  const summaryText = `Task: ${prompt}\n\nPrevious actions:\n${summaryLines.join("\n")}`;

  // Build compressed input: text summary + last turn structured items (skip _page_context)
  const result: Array<Record<string, unknown>> = [
    {
      role: "user",
      content: [{ type: "input_text", text: summaryText }],
    },
  ];

  for (let i = lastTurnStart; i < conversationHistory.length; i++) {
    const item = conversationHistory[i];
    if (item.type === "_page_context") continue;
    result.push(item);
  }

  return result;
}

function buildSystemInstructions(device: DeviceConfig): string {
  const isDesktop = !device.isMobile;

  const envBlock = isDesktop
    ? `**Environment:** Desktop browser (${device.viewport.width}x${device.viewport.height}). We are running on macOS. Use Cmd instead of Ctrl for keyboard shortcuts (e.g. Cmd+L for address bar, Cmd+A for select all, Cmd+C/V for copy/paste).`
    : `**Environment:** Mobile device — ${device.label}. Viewport: ${device.viewport.width}x${device.viewport.height}, touch-enabled. This is a ${device.userAgent.includes("iPhone") || device.userAgent.includes("iPad") ? "iOS" : "Android"} device.
- Use tap/click on UI elements — touch events are handled automatically.
- Do NOT use keyboard shortcuts like Cmd+* or Ctrl+*. Navigate using on-screen UI elements only.
- Expect mobile layouts: hamburger menus, bottom navigation bars, compact views, swipeable panels.
- To scroll, use the scroll action (not keyboard Page Down).
- Elements may be larger and more spread out than on desktop.`;

  return `You are a browser automation agent. You are given a task and must complete it by interacting with a browser.

You have three tools:
1. **goto_url** — Navigate to a URL. Use this ONLY for initial navigation or when you need to go to a completely different page.
2. **computer** — Interact with the current page: click, type, scroll, keypress, etc. Use the computer tool for UI interaction.
3. **file_upload** — Upload a file to a file input element. Use this when the task requires uploading a file. Clicking upload buttons triggers a native OS file dialog that you CANNOT interact with — you MUST use this tool instead. A dummy test file will be created and uploaded automatically. Pass a CSS selector for the file input (usually 'input[type=file]').

${envBlock}

**Important rules:**
- If you are already on the correct page, do NOT call goto_url again. Use the computer tool to click, type, or scroll.
- Be precise with coordinates — look at the screenshot carefully to target the exact position of UI elements.
- After each action, you will receive a new screenshot showing the result.
- **NEVER click file upload/attach buttons** (e.g. +, paperclip, "Choose file"). They open a native OS dialog that is INVISIBLE to you — the screenshot will look unchanged and you will think nothing happened. Instead, ALWAYS use the file_upload tool to upload files directly.
- When done (whether successful or not), respond with a text message (no tool calls) using this exact format:

RESULT: <pass|platform_bug|agent_failure>
SUMMARY: <one sentence describing what happened>
DETAILS: <what you observed that led to this conclusion>

Use "pass" when the task was completed as requested.
Use "platform_bug" when the website/application is broken, unresponsive, shows error messages, or behaves unexpectedly (e.g. buttons don't work, pages fail to load, features are missing). This means the platform under test has a bug.
Use "agent_failure" when you were unable to complete the task due to your own limitations (e.g. could not find an element, misclicked, got confused by the UI).`;
}

function parseVerdict(run: Run): void {
  const msg = run.finalMessage;
  if (!msg) return;

  const resultMatch = msg.match(/RESULT:\s*(pass|success|platform_bug|platform_error|agent_failure)/i);
  const summaryMatch = msg.match(/SUMMARY:\s*(.+?)(?:\n|$)/i);
  const detailsMatch = msg.match(/DETAILS:\s*([\s\S]+)/i);

  if (resultMatch) {
    let raw = resultMatch[1].toLowerCase();
    if (raw === "success") raw = "pass";
    if (raw === "platform_error") raw = "platform_bug";
    run.verdict = raw as Verdict;
  }
  if (summaryMatch) {
    run.verdictSummary = summaryMatch[1].trim();
  }
  if (detailsMatch) {
    run.verdictDetails = detailsMatch[1].trim();
  }
}

export async function runAgent(
  runId: string,
  prompt: string,
  maxTurns: number,
  onEvent: (event: SSEEvent) => void,
): Promise<Run> {
  const screenshotDir = path.join(SCREENSHOTS_BASE, runId);
  const abortController = new AbortController();
  const signal = abortController.signal;

  // Extract device from prompt using gpt-4o-mini
  const device = await extractDevice(prompt);
  console.log(`[${runId}] Detected device: ${device.label} (${device.preset})`);

  const run: Run = {
    id: runId,
    prompt,
    state: "running",
    turns: [],
    startedAt: new Date().toISOString(),
    finishedAt: null,
    finalMessage: null,
    verdict: null,
    verdictSummary: null,
    verdictDetails: null,
    maxTurns,
    error: null,
    device: device.preset,
    deviceLabel: device.label,
  };

  activeRuns.set(runId, abortController);

  let session: BrowserSession | null = null;

  try {
    session = await launchBrowser(device);
    const recentScreenshots: Buffer[] = [];

    // Stateful mode state
    let previousResponseId: string | undefined;

    // Cheap mode state: we manage the full conversation history ourselves
    const conversationHistory: Array<Record<string, unknown>> = [];

    let nextInput: unknown;
    if (MODE !== "stateful") {
      // Seed with the user prompt as first message
      const userMsg = {
        role: "user",
        content: [{ type: "input_text", text: prompt }],
      };
      conversationHistory.push(userMsg);
      nextInput = MODE === "compressed"
        ? buildCompressedInput(conversationHistory, prompt)
        : buildCheapInput(conversationHistory);
    } else {
      // Stateful: text-only first request per CUA docs
      nextInput = prompt;
    }

    for (let turnNum = 1; turnNum <= maxTurns; turnNum++) {
      if (signal.aborted) throw new Error("Run cancelled");

      const turnStart = Date.now();

      // Capture input screenshot for the UI timeline (and stuck detection)
      let inputScreenshotUrl = "";
      if (turnNum > 1) {
        const inputShot = await captureScreenshot(
          session.page,
          screenshotDir,
          `turn-${turnNum}-input`,
          runId,
        );
        inputScreenshotUrl = inputShot.url;
        recentScreenshots.push(inputShot.buffer);
      }
      // Turn 1 has no input screenshot — it's a text-only request per CUA docs

      // Keep only last 5 screenshots for stuck detection
      if (recentScreenshots.length > 5) recentScreenshots.shift();

      // Build turn object
      const turn: Turn = {
        turn: turnNum,
        status: "running",
        inputText: (MODE === "stateful" && turnNum === 1) ? prompt : JSON.stringify(nextInput, (_key, val) => {
          // Truncate base64 image data for display
          if (typeof val === "string" && val.startsWith("data:image/")) {
            const isPlaceholder = val.includes("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4");
            return isPlaceholder ? "[placeholder 1x1 — 0 tokens]" : val.slice(0, 40) + "...[real screenshot ~1600 tokens]";
          }
          return val;
        }, 2),
        inputScreenshotUrl,
        modelResponse: { actions: [], functionCalls: [], message: null },
        rawModelOutput: [],
        executedActions: [],
        resultScreenshotUrl: "",
        actionScreenshotUrls: [],
        pageUrl: "",
        pageTitle: "",
        tokenUsage: { input: 0, output: 0, reasoning: 0 },
        durationMs: 0,
        apiDurationMs: 0,
        createdAt: new Date().toISOString(),
      };
      onEvent({ type: "turn", data: turn });

      const apiStart = Date.now();
      const result: FullModelResult = await callModel({
        input: nextInput,
        instructions: buildSystemInstructions(device),
        previousResponseId: MODE !== "stateful" ? undefined : previousResponseId,
        signal,
        includeGotoUrl: true,
      });
      turn.apiDurationMs = Date.now() - apiStart;

      if (MODE === "stateful") {
        previousResponseId = result.responseId;
      }

      turn.modelResponse = {
        actions: result.actions,
        functionCalls: result.functionCalls.map((fc) => ({
          name: fc.name,
          args: fc.args,
        })),
        message: result.message,
      };
      turn.rawModelOutput = result.rawOutput;
      turn.tokenUsage = result.usage;

      // Check if model returned only a message (task complete)
      const hasToolCalls = result.actions.length > 0 || result.functionCalls.length > 0;

      if (!hasToolCalls) {
        turn.status = "completed";
        turn.durationMs = Date.now() - turnStart;
        const resultShot = await captureScreenshot(
          session.page,
          screenshotDir,
          `turn-${turnNum}-result`,
          runId,
        );
        turn.resultScreenshotUrl = resultShot.url;
        try {
          turn.pageUrl = session.page.url();
          turn.pageTitle = await session.page.title();
        } catch { /* page might be closed */ }
        run.turns.push(turn);
        onEvent({ type: "turn", data: turn });
        run.state = "completed";
        run.finalMessage = result.message;
        parseVerdict(run);
        break;
      }

      // Execute function calls (goto_url, file_upload)
      const functionResults = new Map<string, string>();
      for (const fc of result.functionCalls) {
        if (fc.name === "goto_url" && fc.args.url) {
          const url = String(fc.args.url);
          try {
            await session.page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
            turn.executedActions.push(`goto_url("${url}")`);
            functionResults.set(fc.callId, "Navigation complete");
          } catch (err) {
            const errMsg = (err as Error).message;
            turn.executedActions.push(`goto_url("${url}") — ERROR: ${errMsg}`);
            functionResults.set(fc.callId, `Error: ${errMsg}`);
          }
        } else if (fc.name === "file_upload") {
          const selector = String(fc.args.selector ?? "input[type=file]");
          try {
            // Create a dummy test file
            const dummyPath = path.join(screenshotDir, "test-upload.txt");
            fs.writeFileSync(dummyPath, "This is a test file uploaded by the QA Agent.\n");

            // Find the file input and set the file
            const fileInput = await session.page.locator(selector).first();
            await fileInput.setInputFiles(dummyPath);

            turn.executedActions.push(`file_upload("${selector}")`);
            functionResults.set(fc.callId, "File 'test-upload.txt' uploaded successfully to the file input element.");
          } catch (err) {
            const errMsg = (err as Error).message;
            turn.executedActions.push(`file_upload("${selector}") — ERROR: ${errMsg}`);
            functionResults.set(fc.callId, `Error: ${errMsg}`);
          }
        }
      }

      // Execute computer actions — capture a screenshot after each one
      let actionIdx = 0;
      let lastCursorPos: { x: number; y: number } | undefined;
      for (const action of result.actions) {
        // Track cursor position from actions that target coordinates
        const ax = Number(action.x ?? 0);
        const ay = Number(action.y ?? 0);
        if (["click", "double_click", "move", "scroll"].includes(action.type) && ax > 0 && ay > 0) {
          lastCursorPos = { x: ax, y: ay };
        }

        try {
          const desc = await executeAction(session.page, action, signal);
          turn.executedActions.push(desc);
        } catch (err) {
          turn.executedActions.push(`ERROR: ${action.type} — ${(err as Error).message}`);
        }

        // Capture per-action screenshot (skip for screenshot-only actions)
        if (action.type !== "screenshot") {
          await new Promise((r) => setTimeout(r, 500));
          const actionShot = await captureScreenshot(
            session.page,
            screenshotDir,
            `turn-${turnNum}-action-${actionIdx}`,
            runId,
            lastCursorPos,
          );
          turn.actionScreenshotUrls.push(actionShot.url);
        }
        actionIdx++;
      }

      // Wait for page to settle after all actions
      await new Promise((r) => setTimeout(r, 500));

      // Capture final result screenshot (used for the model's next input)
      const resultShot = await captureScreenshot(
        session.page,
        screenshotDir,
        `turn-${turnNum}-result`,
        runId,
      );
      turn.resultScreenshotUrl = resultShot.url;

      try {
        turn.pageUrl = session.page.url();
        turn.pageTitle = await session.page.title();
      } catch { /* page might be navigating */ }

      if (MODE !== "stateful") {
        // Append model's output items to conversation history
        for (const item of result.rawOutput) {
          conversationHistory.push(item);
        }
        // Append our tool outputs (with real screenshot for now)
        const toolOutputs = buildToolOutputs(
          result.rawOutput,
          resultShot.dataUrl,
          functionResults,
        );
        for (const item of toolOutputs) {
          conversationHistory.push(item);
        }
        // Add page context marker (used by compressed mode summary, stripped before sending)
        conversationHistory.push({
          type: "_page_context",
          url: turn.pageUrl || "",
          title: turn.pageTitle || "",
        });
        // Build input based on mode
        nextInput = MODE === "compressed"
          ? buildCompressedInput(conversationHistory, prompt)
          : buildCheapInput(conversationHistory);
      } else {
        // Stateful: send tool outputs referencing previous_response_id
        nextInput = buildToolOutputs(
          result.rawOutput,
          resultShot.dataUrl,
          functionResults,
        );
      }

      // Check if stuck
      if (isStuck(recentScreenshots)) {
        turn.status = "stuck";
        turn.durationMs = Date.now() - turnStart;
        run.turns.push(turn);
        onEvent({ type: "turn", data: turn });
        run.state = "stuck";
        break;
      }

      turn.status = "completed";
      turn.durationMs = Date.now() - turnStart;
      run.turns.push(turn);
      onEvent({ type: "turn", data: turn });
    }

    // If we exhausted all turns without completing
    if (run.state === "running") {
      run.state = "fail";
      run.error = `Reached maximum turns (${maxTurns}) without completing the task`;
    }
  } catch (err) {
    const error = err as Error;
    if (error.message === "Run cancelled" || signal.aborted) {
      run.state = "fail";
      run.error = "Run was cancelled";
    } else {
      run.state = "fail";
      run.error = error.message;
    }
  } finally {
    if (session) {
      try {
        await session.close();
      } catch { /* ignore */ }
    }
    run.finishedAt = new Date().toISOString();
    activeRuns.delete(runId);

    // Generate MP4 from all result screenshots
    let videoUrl: string | null = null;
    try {
      const mp4Path = await generateRunVideo(screenshotDir, runId);
      if (mp4Path) {
        videoUrl = `/api/run/${runId}/video`;
      }
    } catch { /* video generation is best-effort */ }

    // Persist full run data to disk
    try {
      fs.writeFileSync(
        path.join(screenshotDir, "run.json"),
        JSON.stringify(run, null, 2),
      );
    } catch { /* persistence is best-effort */ }

    onEvent({
      type: "run_complete",
      data: {
        state: run.state,
        finalMessage: run.finalMessage,
        verdict: run.verdict,
        verdictSummary: run.verdictSummary,
        verdictDetails: run.verdictDetails,
        error: run.error,
        totalTurns: run.turns.length,
        videoUrl,
        device: run.device,
        deviceLabel: run.deviceLabel,
      },
    });
  }

  return run;
}

// ── Active run management ──

const activeRuns = new Map<string, AbortController>();

export function stopRun(runId: string): boolean {
  const controller = activeRuns.get(runId);
  if (controller) {
    controller.abort();
    return true;
  }
  return false;
}

export function getScreenshotDir(runId: string): string {
  return path.join(SCREENSHOTS_BASE, runId);
}
