"use client";

import FramePlayer from "./FramePlayer";

type RunState = "idle" | "running" | "completed" | "failed" | "stuck";
type Verdict = "success" | "platform_error" | "agent_failure" | null;

type Props = {
  state: RunState;
  verdict: Verdict;
  currentTurn: number;
  totalDurationMs: number;
  prompt: string | null;
  frames: string[];
};

const VERDICT_LABELS: Record<string, string> = {
  success: "PASS",
  platform_error: "PLATFORM BUG",
  agent_failure: "AGENT FAILURE",
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
}: Props) {
  const isFinished = state === "completed" || state === "failed" || state === "stuck";

  const badgeClass = verdict
    ? `verdict-${verdict}`
    : state === "failed"
      ? "verdict-platform_error"
      : state === "stuck"
        ? "verdict-agent_failure"
        : "";
  const badgeLabel = verdict
    ? (VERDICT_LABELS[verdict] ?? verdict)
    : state === "failed"
      ? "FAIL"
      : state === "stuck"
        ? "STUCK"
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
      {frames.length > 0 && <FramePlayer frames={frames} />}
    </div>
  );
}
