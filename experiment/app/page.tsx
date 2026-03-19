"use client";

import { useState, useRef, useCallback } from "react";
import PromptBar from "./components/PromptBar";
import RunOverview from "./components/RunOverview";
import TurnTimeline from "./components/TurnTimeline";
import RunHistory from "./components/RunHistory";

type TurnStatus = "running" | "completed" | "stuck" | "error";
type RunState = "idle" | "running" | "completed" | "fail" | "stuck";
type Verdict = "pass" | "platform_bug" | "agent_failure" | null;

type Turn = {
  turn: number;
  status: TurnStatus;
  inputText: string;
  inputScreenshotUrl: string;
  modelResponse: {
    actions: Array<Record<string, unknown>>;
    functionCalls: Array<{ name: string; args: Record<string, unknown> }>;
    message: string | null;
  };
  rawModelOutput: Array<Record<string, unknown>>;
  executedActions: string[];
  resultScreenshotUrl: string;
  actionScreenshotUrls: string[];
  pageUrl: string;
  pageTitle: string;
  tokenUsage: { input: number; output: number; reasoning: number };
  durationMs: number;
  apiDurationMs: number;
};

const API_BASE = "http://localhost:4001";

function buildFrameUrls(turns: Turn[]): string[] {
  const frames: string[] = [];
  for (const t of turns) {
    // Skip turn 1 input — it's always a blank about:blank page
    if (t.turn > 1 && t.inputScreenshotUrl) frames.push(API_BASE + t.inputScreenshotUrl);
    for (const url of t.actionScreenshotUrls ?? []) {
      frames.push(API_BASE + url);
    }
    if (t.resultScreenshotUrl) frames.push(API_BASE + t.resultScreenshotUrl);
  }
  return frames;
}

export default function Home() {
  // Live run state
  const [runState, setRunState] = useState<RunState>("idle");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [maxTurns] = useState(20);
  const [finalMessage, setFinalMessage] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<Verdict>(null);
  const [verdictSummary, setVerdictSummary] = useState<string | null>(null);
  const [verdictDetails, setVerdictDetails] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [totalDurationMs, setTotalDurationMs] = useState<number>(0);
  const eventSourceRef = useRef<EventSource | null>(null);
  const runStartTimeRef = useRef<number>(0);

  // History state
  const [viewMode, setViewMode] = useState<"live" | "history">("live");
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<string | null>(null);
  const currentTurn = turns.length > 0 ? turns[turns.length - 1].turn : 0;
  const displayedRunId = viewMode === "history" ? selectedRunId : runId;
  const videoUrl = displayedRunId ? `${API_BASE}/api/run/${displayedRunId}/video` : null;

  const resetLiveState = useCallback(() => {
    setTurns([]);
    setRunState("idle");
    setFinalMessage(null);
    setVerdict(null);
    setVerdictSummary(null);
    setVerdictDetails(null);
    setError(null);
    setTotalDurationMs(0);
    setPrompt(null);
  }, []);

  const handleRun = useCallback(
    async (prompt: string) => {
      // Switch to live mode
      setViewMode("live");
      setSelectedRunId(null);

      // Close any existing SSE connection
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }

      // Reset state
      resetLiveState();
      setRunState("running");
      setPrompt(prompt);
      runStartTimeRef.current = Date.now();

      try {
        const res = await fetch(`${API_BASE}/api/run`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt, maxTurns }),
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || "Failed to start run");
        }

        const { runId: id } = await res.json();
        setRunId(id);

        // Connect SSE directly to Fastify (Next.js proxy buffers SSE)
        const es = new EventSource(`${API_BASE}/api/run/${id}/events`);
        eventSourceRef.current = es;

        es.onmessage = (event) => {
          try {
            const parsed = JSON.parse(event.data);

            if (parsed.type === "turn") {
              const turn = parsed.data as Turn;
              setTurns((prev) => {
                const idx = prev.findIndex((t) => t.turn === turn.turn);
                if (idx >= 0) {
                  const next = [...prev];
                  next[idx] = turn;
                  return next;
                }
                return [...prev, turn];
              });
            } else if (parsed.type === "run_complete") {
              setRunState(parsed.data.state);
              setFinalMessage(parsed.data.finalMessage);
              setVerdict(parsed.data.verdict ?? null);
              setVerdictSummary(parsed.data.verdictSummary ?? null);
              setVerdictDetails(parsed.data.verdictDetails ?? null);
              setError(parsed.data.error);
              setTotalDurationMs(Date.now() - runStartTimeRef.current);
              es.close();
              eventSourceRef.current = null;
            }
          } catch {
            // ignore parse errors
          }
        };

        es.onerror = () => {
          es.close();
          eventSourceRef.current = null;
          // Only set failed if still running (not already completed)
          setRunState((prev) =>
            prev === "running" ? "fail" : prev,
          );
        };
      } catch (err) {
        setRunState("fail");
        setError((err as Error).message);
      }
    },
    [maxTurns, resetLiveState],
  );

  const handleStop = useCallback(async () => {
    if (runId) {
      try {
        await fetch(`${API_BASE}/api/run/${runId}/stop`, { method: "POST" });
      } catch {
        // ignore
      }
    }
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  }, [runId]);

  const handleSelectRun = useCallback(async (id: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/run/${id}/data`);
      if (!res.ok) return;
      const data = await res.json();

      setViewMode("history");
      setSelectedRunId(id);
      setPrompt(data.prompt ?? null);
      setTurns(data.turns ?? []);
      setRunState(data.state);
      setFinalMessage(data.finalMessage ?? null);
      setVerdict(data.verdict ?? null);
      setVerdictSummary(data.verdictSummary ?? null);
      setVerdictDetails(data.verdictDetails ?? null);
      setError(data.error ?? null);

      // Calculate duration from timestamps
      if (data.startedAt && data.finishedAt) {
        setTotalDurationMs(new Date(data.finishedAt).getTime() - new Date(data.startedAt).getTime());
      }

      // Scroll to top to show the Overview block
      window.scrollTo({ top: 0 });
    } catch { /* ignore */ }
  }, []);

  const handleNewRun = useCallback(() => {
    setViewMode("live");
    setSelectedRunId(null);
    // Don't reset if there's an active run
    if (runState !== "running") {
      resetLiveState();
    }
  }, [runState, resetLiveState]);

  const isFinished = runState === "completed" || runState === "fail" || runState === "stuck";

  return (
    <div className="app-layout">
      <RunHistory
        activeRunId={runState === "running" ? runId : null}
        selectedRunId={viewMode === "history" ? selectedRunId : runId}
        onSelectRun={handleSelectRun}
        onNewRun={handleNewRun}
      />

      <div className="app">
        <header className="app-header">
          <h1>QA Agent</h1>
        </header>

        <div className="app-body">
          {viewMode === "live" && (
            <PromptBar
              onRun={handleRun}
              onStop={handleStop}
              isRunning={runState === "running"}
            />
          )}

          {/* Overview block — top */}
          <RunOverview
            state={runState}
            verdict={verdict}
            currentTurn={currentTurn}
            totalDurationMs={totalDurationMs}
            prompt={prompt}
            frames={isFinished ? buildFrameUrls(turns) : []}
            videoUrl={isFinished ? videoUrl : null}
          />

          <TurnTimeline turns={turns} autoScroll={viewMode === "live"} />

          {/* Overview block — bottom (only when finished with turns) */}
          {isFinished && turns.length > 0 && (
            <RunOverview
              state={runState}
              verdict={verdict}
              currentTurn={currentTurn}
              totalDurationMs={totalDurationMs}
              prompt={prompt}
              frames={buildFrameUrls(turns)}
              videoUrl={videoUrl}
            />
          )}
        </div>
      </div>
    </div>
  );
}
