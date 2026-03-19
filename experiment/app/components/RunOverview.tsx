"use client";

import FramePlayer from "./FramePlayer";

type RunState = "idle" | "running" | "completed" | "fail" | "stuck";
type Verdict = "pass" | "platform_bug" | "agent_failure" | null;

type Props = {
  state: RunState;
  verdict: Verdict;
  currentTurn: number;
  totalDurationMs: number;
  prompt: string | null;
  frames: string[];
  videoUrl?: string | null;
};

const VERDICT_LABELS: Record<string, string> = {
  pass: "PASS",
  success: "PASS",
  platform_bug: "FAIL",
  platform_error: "FAIL",
  agent_failure: "AGENT FAIL",
};

function formatDuration(ms: number): string {
  if (ms === 0) return "";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export default function RunOverview({
  state,
  verdict,
  currentTurn,
  totalDurationMs,
  prompt,
  frames,
  videoUrl,
}: Props) {
  const isFinished = state === "completed" || state === "fail" || state === "stuck";

  const badgeClass = verdict
    ? `verdict-${verdict}`
    : state === "fail"
      ? "verdict-fail"
      : state === "stuck"
        ? "verdict-fail"
        : "";
  const badgeLabel = verdict
    ? (VERDICT_LABELS[verdict] ?? verdict)
    : state === "fail"
      ? "FAIL"
      : state === "stuck"
        ? "FAIL"
        : "";

  return (
    <div className="run-overview">
      {/* Status line */}
      <div className={`run-status ${state}`}>
        <span className="dot" />
        {isFinished && badgeLabel ? (
          <>
            <span className={`verdict-badge ${badgeClass}`}>{badgeLabel}</span>
            <span>
              {currentTurn} turn{currentTurn !== 1 ? "s" : ""}
              {totalDurationMs > 0 && ` in ${formatDuration(totalDurationMs)}`}
            </span>
          </>
        ) : (
          <span>
            {state === "idle" ? "Ready" : "Running"}
            {state === "running" && ` — Turn ${currentTurn}`}
          </span>
        )}
      </div>

      {/* Task prompt */}
      {prompt && (
        <div className="run-overview-task">
          <span className="turn-section-label turn-section-label-task">Task</span>
          <ul className="turn-actions-list turn-actions-task">
            <li><code>{prompt}</code></li>
          </ul>
        </div>
      )}

      {/* Frame player */}
      {frames.length > 0 && <FramePlayer frames={frames} videoUrl={videoUrl} />}
    </div>
  );
}
