"use client";

type RunState = "idle" | "running" | "completed" | "failed" | "stuck";
type Verdict = "success" | "platform_error" | "agent_failure" | null;

type Props = {
  state: RunState;
  currentTurn: number;
  maxTurns: number;
  verdict: Verdict;
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

export default function RunStatus({
  state,
  currentTurn,
  maxTurns,
  verdict,
  error,
  totalDurationMs,
}: Props) {
  const isFinished = state === "completed" || state === "failed" || state === "stuck";

  // Determine the badge to show for finished runs
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
          {LABELS[state]}
          {state === "running" && ` — Turn ${currentTurn} of ${maxTurns}`}
        </span>
      )}
    </div>
  );
}
