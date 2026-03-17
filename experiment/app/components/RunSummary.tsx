"use client";

import FramePlayer from "./FramePlayer";

type RunState = "idle" | "running" | "completed" | "failed" | "stuck";
type Verdict = "success" | "platform_error" | "agent_failure" | null;

type Props = {
  state: RunState;
  verdict: Verdict;
  verdictSummary: string | null;
  verdictDetails: string | null;
  error: string | null;
  frames: string[];
  totalDurationMs: number;
  totalTurns: number;
};

const VERDICT_LABELS: Record<string, string> = {
  success: "PASS",
  platform_error: "PLATFORM BUG",
  agent_failure: "AGENT FAILURE",
};

const STATE_LABELS: Record<string, string> = {
  completed: "Completed",
  failed: "Failed",
  stuck: "Stuck",
};

function formatDuration(ms: number): string {
  if (ms === 0) return "";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export default function RunSummary({
  state,
  verdict,
  verdictSummary,
  verdictDetails,
  error,
  frames,
  totalDurationMs,
  totalTurns,
}: Props) {
  return (
    <div className="run-summary">
      {/* Status header */}
      <div className={`run-summary-header run-summary-${state}`}>
        <span className="dot" />
        <span className="run-summary-title">
          {STATE_LABELS[state] ?? state} — {totalTurns} turn{totalTurns !== 1 ? "s" : ""}
          {totalDurationMs > 0 && ` in ${formatDuration(totalDurationMs)}`}
        </span>
        {verdict && (
          <span className={`verdict-badge verdict-${verdict}`}>
            {VERDICT_LABELS[verdict] ?? verdict}
          </span>
        )}
        {verdictSummary && (
          <span className="run-summary-message">{verdictSummary}</span>
        )}
        {!verdict && state === "failed" && error && (
          <span className="run-summary-message">{error}</span>
        )}
        {state === "stuck" && (
          <span className="run-summary-message">
            Agent detected no progress after 5 identical screenshots
          </span>
        )}
      </div>
      {verdictDetails && (
        <div className="run-summary-details">{verdictDetails}</div>
      )}

      {/* Frame-by-frame player */}
      {frames.length > 0 && <FramePlayer frames={frames} />}
    </div>
  );
}
