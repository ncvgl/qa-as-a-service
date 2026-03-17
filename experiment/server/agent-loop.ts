import * as fs from "node:fs";
import * as path from "node:path";
import { launchBrowser, captureScreenshot, executeAction, type BrowserSession } from "./browser.js";
import { callModel, buildToolOutputs, type FullModelResult } from "./openai.js";
import { isStuck } from "./stuck-detector.js";
import { generateRunGif } from "./gif-generator.js";
import type { Run, Turn, SSEEvent, Verdict } from "./types.js";

const SCREENSHOTS_BASE = path.join(process.cwd(), "screenshots");

const SYSTEM_INSTRUCTIONS = `You are a browser automation agent. You are given a task and must complete it by interacting with a browser.

You have three tools:
1. **goto_url** — Navigate to a URL. Use this ONLY for initial navigation or when you need to go to a completely different page.
2. **computer** — Interact with the current page: click, type, scroll, keypress, etc. Use the computer tool for UI interaction.
3. **file_upload** — Upload a file to a file input element. Use this when the task requires uploading a file. Clicking upload buttons triggers a native OS file dialog that you CANNOT interact with — you MUST use this tool instead. A dummy test file will be created and uploaded automatically. Pass a CSS selector for the file input (usually 'input[type=file]').

**Environment:** We are running on macOS. Use Cmd instead of Ctrl for keyboard shortcuts (e.g. Cmd+L for address bar, Cmd+A for select all, Cmd+C/V for copy/paste).

**Important rules:**
- If you are already on the correct page, do NOT call goto_url again. Use the computer tool to click, type, or scroll.
- Be precise with coordinates — look at the screenshot carefully to target the exact position of UI elements.
- After each action, you will receive a new screenshot showing the result.
- When done (whether successful or not), respond with a text message (no tool calls) using this exact format:

RESULT: <success|platform_error|agent_failure>
SUMMARY: <one sentence describing what happened>
DETAILS: <what you observed that led to this conclusion>

Use "success" when the task was completed as requested.
Use "platform_error" when the website/application is broken, unresponsive, shows error messages, or behaves unexpectedly (e.g. buttons don't work, pages fail to load, features are missing). This means the platform under test has a bug.
Use "agent_failure" when you were unable to complete the task due to your own limitations (e.g. could not find an element, misclicked, got confused by the UI).`;

function parseVerdict(run: Run): void {
  const msg = run.finalMessage;
  if (!msg) return;

  const resultMatch = msg.match(/RESULT:\s*(success|platform_error|agent_failure)/i);
  const summaryMatch = msg.match(/SUMMARY:\s*(.+?)(?:\n|$)/i);
  const detailsMatch = msg.match(/DETAILS:\s*([\s\S]+)/i);

  if (resultMatch) {
    run.verdict = resultMatch[1].toLowerCase() as Verdict;
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
  };

  activeRuns.set(runId, abortController);

  let session: BrowserSession | null = null;

  try {
    session = await launchBrowser();
    const recentScreenshots: Buffer[] = [];

    // State for the stateful Responses API loop
    let previousResponseId: string | undefined;

    // Per the CUA docs, the first request should be text-only.
    // The model will respond with a screenshot request before taking actions.
    let nextInput: unknown = prompt;

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
        inputText: turnNum === 1 ? prompt : JSON.stringify(nextInput, (_key, val) => {
          // Truncate base64 image data for display
          if (typeof val === "string" && val.startsWith("data:image/")) {
            return val.slice(0, 40) + "...[base64 screenshot]";
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

      // Call model (stateful with previous_response_id)
      const apiStart = Date.now();
      const result: FullModelResult = await callModel({
        input: nextInput,
        instructions: SYSTEM_INSTRUCTIONS,
        previousResponseId,
        signal,
        includeGotoUrl: true,
      });
      turn.apiDurationMs = Date.now() - apiStart;

      previousResponseId = result.responseId;

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

      // Build tool outputs to send back (stateful approach)
      // Note: screenshots can only be sent via computer_call_output, not as
      // user messages (API rejects input_image with previous_response_id).
      // So function-call-only turns (e.g. goto_url) will be "blind" — the
      // model will request a screenshot on the next turn automatically.
      nextInput = buildToolOutputs(
        result.rawOutput,
        resultShot.dataUrl,
        functionResults,
      );

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
      run.state = "failed";
      run.error = `Reached maximum turns (${maxTurns}) without completing the task`;
    }
  } catch (err) {
    const error = err as Error;
    if (error.message === "Run cancelled" || signal.aborted) {
      run.state = "failed";
      run.error = "Run was cancelled";
    } else {
      run.state = "failed";
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

    // Generate GIF from all result screenshots
    let gifUrl: string | null = null;
    try {
      const gifPath = await generateRunGif(screenshotDir, runId);
      if (gifPath) {
        gifUrl = `/api/run/${runId}/gif`;
      }
    } catch { /* gif generation is best-effort */ }

    // Persist run data to disk (strip rawModelOutput to save space)
    try {
      const savedRun = {
        ...run,
        turns: run.turns.map(({ rawModelOutput, ...rest }) => rest),
      };
      fs.writeFileSync(
        path.join(screenshotDir, "run.json"),
        JSON.stringify(savedRun, null, 2),
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
        gifUrl,
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
