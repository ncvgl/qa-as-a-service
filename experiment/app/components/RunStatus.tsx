"use client";

type RunState = "idle" | "running" | "completed" | "failed" | "stuck";

type Props = {
  state: RunState;
  currentTurn: number;
  maxTurns: number;
  finalMessage: string | null;
  error: string | null;
  totalDurationMs: number;
};

const LABELS: Record<RunState, string> = {
  idle: "Ready",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  stuck: "Stuck",
};

function formatDuration(ms: number): string {
  if (ms === 0) return "";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export default function RunStatus({
  state,
  currentTurn,
  maxTurns,
  finalMessage,
  error,
  totalDurationMs,
}: Props) {
  return (
    <div className={`run-status ${state}`}>
      <span className="dot" />
      <span>
        {LABELS[state]}
        {state === "running" && ` — Turn ${currentTurn} of ${maxTurns}`}
        {(state === "completed" || state === "failed" || state === "stuck") &&
          currentTurn > 0 &&
          ` — ${currentTurn} turn${currentTurn !== 1 ? "s" : ""}`}
        {totalDurationMs > 0 && ` in ${formatDuration(totalDurationMs)}`}
      </span>
      {state === "completed" && finalMessage && (
        <span className="final-message">{finalMessage}</span>
      )}
      {state === "failed" && error && (
        <span className="final-message">{error}</span>
      )}
      {state === "stuck" && (
        <span className="final-message">
          Agent detected no progress after 3 similar screenshots
        </span>
      )}
    </div>
  );
}
