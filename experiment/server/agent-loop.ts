import * as path from "node:path";
import { launchBrowser, captureScreenshot, executeAction, type BrowserSession } from "./browser.js";
import { callModel, buildToolOutputs, type FullModelResult } from "./openai.js";
import { isStuck } from "./stuck-detector.js";
import type { Run, Turn, SSEEvent } from "./types.js";

const SCREENSHOTS_BASE = path.join(process.cwd(), "screenshots");

const SYSTEM_INSTRUCTIONS = `You are a browser automation agent. You are given a task and must complete it by interacting with a browser.

You have two tools:
1. **goto_url** — Navigate to a URL. Use this ONLY for initial navigation or when you need to go to a completely different page.
2. **computer** — Interact with the current page: click, type, scroll, keypress, etc. Use the computer tool for UI interaction.

**Environment:** We are running on macOS. Use Cmd instead of Ctrl for keyboard shortcuts (e.g. Cmd+L for address bar, Cmd+A for select all, Cmd+C/V for copy/paste).

**Important rules:**
- If you are already on the correct page, do NOT call goto_url again. Use the computer tool to click, type, or scroll.
- Be precise with coordinates — look at the screenshot carefully to target the exact position of UI elements.
- After each action, you will receive a new screenshot showing the result.
- When the task is fully completed, respond with a text message (no tool calls) summarizing what you accomplished.
- If you get stuck or cannot complete the task, respond with a text message explaining what went wrong.`;

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
        pageUrl: "",
        pageTitle: "",
        tokenUsage: { input: 0, output: 0, reasoning: 0 },
        durationMs: 0,
        createdAt: new Date().toISOString(),
      };
      onEvent({ type: "turn", data: turn });

      // Call model (stateful with previous_response_id)
      const result: FullModelResult = await callModel({
        input: nextInput,
        instructions: SYSTEM_INSTRUCTIONS,
        previousResponseId,
        signal,
        includeGotoUrl: true,
      });

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
        break;
      }

      // Execute function calls (goto_url)
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
        }
      }

      // Execute computer actions
      for (const action of result.actions) {
        try {
          const desc = await executeAction(session.page, action, signal);
          turn.executedActions.push(desc);
        } catch (err) {
          turn.executedActions.push(`ERROR: ${action.type} — ${(err as Error).message}`);
        }
      }

      // Wait for page to settle after actions (e.g. navigation, rendering)
      await new Promise((r) => setTimeout(r, 1000));

      // Capture result screenshot
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

    onEvent({
      type: "run_complete",
      data: {
        state: run.state,
        finalMessage: run.finalMessage,
        error: run.error,
        totalTurns: run.turns.length,
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
