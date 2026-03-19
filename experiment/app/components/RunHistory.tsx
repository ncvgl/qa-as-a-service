"use client";

import { useState, useEffect, useCallback } from "react";

type RunState = "idle" | "running" | "completed" | "fail" | "stuck";
type Verdict = "pass" | "platform_bug" | "agent_failure" | null;

type RunMeta = {
  id: string;
  prompt: string;
  state: RunState;
  verdict: Verdict;
  verdictSummary: string | null;
  startedAt: string;
  finishedAt: string | null;
  totalTurns: number;
  error: string | null;
};

type Props = {
  activeRunId: string | null;
  selectedRunId: string | null;
  onSelectRun: (id: string) => void;
  onNewRun: () => void;
};

const VERDICT_LABELS: Record<string, string> = {
  pass: "PASS",
  success: "PASS",
  platform_bug: "FAIL",
  platform_error: "FAIL",
  agent_failure: "AGENT FAIL",
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function RunHistory({ activeRunId, selectedRunId, onSelectRun, onNewRun }: Props) {
  const [runs, setRuns] = useState<RunMeta[]>([]);

  const fetchRuns = useCallback(async () => {
    try {
      const res = await fetch("http://localhost:4001/api/runs");
      if (res.ok) {
        setRuns(await res.json());
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    fetchRuns();
    // Refresh list when a run completes
    const interval = setInterval(fetchRuns, 5_000);
    return () => clearInterval(interval);
  }, [fetchRuns]);

  // Refresh when active run changes (likely completed)
  useEffect(() => {
    if (!activeRunId) fetchRuns();
  }, [activeRunId, fetchRuns]);

  return (
    <aside className="run-history">
      <div className="run-history-header">
        <span className="run-history-title">History</span>
        <button className="run-history-new-btn" onClick={onNewRun}>+ New</button>
      </div>

      <div className="run-history-list">
        {runs.length === 0 && (
          <div className="run-history-empty">No runs yet</div>
        )}
        {runs.map((run) => (
          <button
            key={run.id}
            className={`run-history-item ${selectedRunId === run.id ? "selected" : ""}`}
            onClick={() => onSelectRun(run.id)}
          >
            <div className="run-history-item-top">
              {run.verdict && (
                <span className={`run-history-verdict verdict-${run.verdict}`}>
                  {VERDICT_LABELS[run.verdict] ?? run.verdict}
                </span>
              )}
              {!run.verdict && run.state === "fail" && (
                <span className="run-history-verdict verdict-fail">FAIL</span>
              )}
              {!run.verdict && run.state === "stuck" && (
                <span className="run-history-verdict verdict-fail">FAIL</span>
              )}
              {run.state === "running" && (
                <span className="run-history-verdict verdict-running">RUNNING</span>
              )}
              <span className="run-history-time">{timeAgo(run.startedAt)}</span>
            </div>
            <div className="run-history-prompt">{run.prompt}</div>
          </button>
        ))}
      </div>
    </aside>
  );
}
