import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import type { RunEvent } from "@cua-sample/replay-schema";

import { RunnerManager } from "../src/index.js";

const tempRoots: string[] = [];

afterEach(async () => {
  for (const root of tempRoots.splice(0)) {
    await import("node:fs/promises").then(({ rm }) =>
      rm(root, { force: true, recursive: true }),
    );
  }
});

async function createManager(stepDelayMs = 10) {
  const root = await mkdtemp(join(tmpdir(), "cua-sample-runner-core-"));
  tempRoots.push(root);

  return {
    dataRoot: root,
    manager: new RunnerManager({
      dataRoot: root,
      stepDelayMs,
    }),
  };
}

describe("RunnerManager", () => {
  it("fails the kanban native executor honestly when live Responses is unavailable", async () => {
    const { manager } = await createManager(5);

    const detail = await manager.startRun({
      browserMode: "headless",
      maxResponseTurns: 18,
      mode: "native",
      prompt: [
        "Reorganize the board to match this requested final board state exactly.",
        "",
        "backlog: Refresh workspace docs",
        "in_progress: Close nav bug triage -> Finalize analytics spec",
        "done: Circulate launch brief -> Audit replay artifacts -> Polish stage tooltips",
      ].join("\n"),
      scenarioId: "kanban-reprioritize-sprint",
    });

    const failed = await manager.waitForRunStatus(detail.run.id, "failed");

    expect(failed.run.status).toBe("failed");
    expect(
      failed.events.some(
        (event: RunEvent) =>
          event.type === "run_failed" &&
          event.message.includes("live Responses API"),
      ),
    ).toBe(true);
  });

  it("fails the paint native executor honestly when live Responses is unavailable", async () => {
    const { manager } = await createManager(5);

    const detail = await manager.startRun({
      browserMode: "headless",
      maxResponseTurns: 18,
      mode: "native",
      prompt: "Paint me a smiley face as simple pixel art and save the draft.",
      scenarioId: "paint-draw-poster",
    });

    const failed = await manager.waitForRunStatus(detail.run.id, "failed");

    expect(failed.run.status).toBe("failed");
    expect(
      failed.events.some(
        (event: RunEvent) =>
          event.type === "run_failed" &&
          event.message.includes("live Responses API"),
      ),
    ).toBe(true);
  });

  it("fails the booking native executor honestly when live Responses is unavailable", async () => {
    const { manager } = await createManager(5);

    const detail = await manager.startRun({
      browserMode: "headless",
      maxResponseTurns: 18,
      mode: "native",
      prompt: [
        "Complete the reservation flow using only the request below.",
        "",
        "hotel: Luma Harbor Hotel",
        "neighborhood: Marina District",
        "check_in: 2026-04-18",
        "check_out: 2026-04-21",
        "guest_name: Ada Lovelace",
        "guest_email: ada.lovelace@example.com",
        "requires: breakfast included, workspace desk",
        "special_request: Late arrival after 9pm.",
      ].join("\n"),
      scenarioId: "booking-complete-reservation",
    });

    const failed = await manager.waitForRunStatus(detail.run.id, "failed");

    expect(failed.run.status).toBe("failed");
    expect(
      failed.events.some(
        (event: RunEvent) =>
          event.type === "run_failed" &&
          event.message.includes("live Responses API"),
      ),
    ).toBe(true);
  });

  it("cancels a running run", async () => {
    const { manager } = await createManager(40);

    const detail = await manager.startRun({
      browserMode: "headless",
      mode: "native",
      prompt: [
        "Reorganize the board to match this requested final board state exactly.",
        "",
        "backlog: Refresh workspace docs",
        "in_progress: Close nav bug triage -> Finalize analytics spec",
        "done: Circulate launch brief -> Audit replay artifacts -> Polish stage tooltips",
      ].join("\n"),
      scenarioId: "kanban-reprioritize-sprint",
    });

    const cancelled = await manager.stopRun(detail.run.id, "Stop button pressed.");

    expect(cancelled.run.status).toBe("cancelled");
    expect(
      cancelled.events.some((event: RunEvent) => event.type === "run_cancelled"),
    ).toBe(true);
  });

  it("resets a scenario workspace and cancels the active run for that scenario", async () => {
    const { manager } = await createManager(50);

    const detail = await manager.startRun({
      browserMode: "headful",
      mode: "native",
      prompt: [
        "Complete the reservation flow using only the request below.",
        "",
        "hotel: Luma Harbor Hotel",
        "neighborhood: Marina District",
        "check_in: 2026-04-18",
        "check_out: 2026-04-21",
        "guest_name: Ada Lovelace",
        "guest_email: ada.lovelace@example.com",
        "requires: breakfast included, workspace desk",
        "special_request: Late arrival after 9pm.",
      ].join("\n"),
      scenarioId: "booking-complete-reservation",
    });

    const state = await manager.resetScenario("booking-complete-reservation");
    const cancelled = await manager.getRunDetail(detail.run.id);

    expect(cancelled.run.status).toBe("cancelled");
    expect(state.cancelledRunId).toBe(detail.run.id);
    expect(existsSync(state.workspacePath)).toBe(true);
    expect(existsSync(join(state.workspacePath, "README.md"))).toBe(true);
  });
});
