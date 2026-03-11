import { launchBrowserSession } from "@cua-sample/browser-runtime";
import { type ExecutionMode } from "@cua-sample/replay-schema";

import {
  createDefaultResponsesClient,
  runResponsesCodeLoop,
  runResponsesNativeComputerLoop,
  runResponsesNativeStatelessLoop,
} from "../responses-loop.js";
import {
  assertActive,
  failLiveResponsesUnavailable,
  maybeHoldHeadfulBrowserOpen,
  type RunExecutionContext,
  type RunExecutor,
} from "../scenario-runtime.js";

const liveOnlyMessage =
  "Custom tasks require the live Responses API.";

const customNativeInstructions = `You are a computer-use agent controlling a Chromium browser. Follow the operator's instructions precisely. Navigate to any URLs mentioned in the prompt, interact with pages as instructed, and report what you find or accomplish. If the prompt asks you to test something, describe the results clearly.`;

const customStatelessInstructions = `You are a computer-use agent controlling a Chromium browser. Follow the operator's instructions precisely. Navigate to any URLs mentioned in the prompt, interact with pages as instructed, and report what you find or accomplish. If the prompt asks you to test something, describe the results clearly.

You are operating in stateless mode. Each turn you receive a fresh screenshot of the current browser state and a text summary of your previous actions. Use this context to continue where you left off.`;

const customCodeInstructions = `You are a browser automation agent with a Playwright page object available. Follow the operator's instructions precisely. Navigate to any URLs mentioned in the prompt, interact with pages as instructed using Playwright APIs, and report what you find or accomplish via console.log(). If the prompt asks you to test something, describe the results clearly.`;

class CustomNativeExecutor implements RunExecutor {
  private readonly stateless: boolean;

  constructor(stateless: boolean) {
    this.stateless = stateless;
  }

  async execute(context: RunExecutionContext) {
    const client = createDefaultResponsesClient();

    if (!client) {
      await failLiveResponsesUnavailable(context, liveOnlyMessage);
      return;
    }

    const loopLabel = this.stateless ? "stateless native" : "native computer";

    await context.emitEvent({
      detail: context.detail.run.model,
      level: "ok",
      message: `Using the live Responses API ${loopLabel} loop for a custom task.`,
      type: "run_progress",
    });

    const session = await launchBrowserSession({
      browserMode: context.detail.run.browserMode,
      screenshotDir: context.screenshotDirectory,
      startTarget: {
        kind: "remote_url",
        label: "custom browser session",
        url: "about:blank",
      },
      workspacePath: context.detail.workspacePath,
    });

    try {
      assertActive(context.signal);
      await context.syncBrowserState(session);
      await context.emitEvent({
        detail: session.targetLabel,
        level: "ok",
        message: "Browser session launched for custom task.",
        type: "browser_session_started",
      });
      await context.captureScreenshot(session, "custom-initial");

      const loopFn = this.stateless
        ? runResponsesNativeStatelessLoop
        : runResponsesNativeComputerLoop;

      const result = await loopFn(
        {
          context,
          instructions: this.stateless
            ? customStatelessInstructions
            : customNativeInstructions,
          maxResponseTurns: context.detail.run.maxResponseTurns ?? 24,
          prompt: context.detail.run.prompt,
          session,
        },
        client,
      );

      await context.captureScreenshot(session, "custom-final");
      await maybeHoldHeadfulBrowserOpen(context);
      await context.completeRun({
        notes: result.notes,
        outcome: "success",
        verificationPassed: false,
      });
    } finally {
      await session.close();
    }
  }
}

class CustomCodeExecutor implements RunExecutor {
  async execute(context: RunExecutionContext) {
    const client = createDefaultResponsesClient();

    if (!client) {
      await failLiveResponsesUnavailable(context, liveOnlyMessage);
      return;
    }

    await context.emitEvent({
      detail: context.detail.run.model,
      level: "ok",
      message: "Using the live Responses API code loop for a custom task.",
      type: "run_progress",
    });

    const session = await launchBrowserSession({
      browserMode: context.detail.run.browserMode,
      screenshotDir: context.screenshotDirectory,
      startTarget: {
        kind: "remote_url",
        label: "custom browser session",
        url: "about:blank",
      },
      workspacePath: context.detail.workspacePath,
    });

    try {
      assertActive(context.signal);
      await context.syncBrowserState(session);
      await context.emitEvent({
        detail: session.targetLabel,
        level: "ok",
        message: "Browser session launched for custom task.",
        type: "browser_session_started",
      });
      await context.captureScreenshot(session, "custom-initial");

      const result = await runResponsesCodeLoop(
        {
          context,
          instructions: customCodeInstructions,
          maxResponseTurns: context.detail.run.maxResponseTurns ?? 24,
          prompt: context.detail.run.prompt,
          session,
        },
        client,
      );

      await context.captureScreenshot(session, "custom-final");
      await maybeHoldHeadfulBrowserOpen(context);
      await context.completeRun({
        notes: result.notes,
        outcome: "success",
        verificationPassed: false,
      });
    } finally {
      await session.close();
    }
  }
}

export function createCustomExecutor(mode: ExecutionMode, stateless = false): RunExecutor {
  if (mode === "native") {
    return new CustomNativeExecutor(stateless);
  }
  return new CustomCodeExecutor();
}
