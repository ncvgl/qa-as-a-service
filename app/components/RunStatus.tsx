"use client";

type RunState = "idle" | "running" | "completed" | "fail" | "stuck";
type Verdict = "pass" | "platform_bug" | "agent_failure" | null;

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
  fail: "Fail",
  stuck: "Stuck",
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

export default function RunStatus({
  state,
  currentTurn,
  maxTurns,
  verdict,
  error,
  totalDurationMs,
}: Props) {
  const isFinished = state === "completed" || state === "fail" || state === "stuck";

  // Determine the badge to show for finished runs
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
    <div className={`run-status ${state}${isFinished && verdict ? ` run-status-${verdict}` : ""}`}>
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
