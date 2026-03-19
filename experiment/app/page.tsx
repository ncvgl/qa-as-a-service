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

type RunData = {
  runState: RunState;
  turns: Turn[];
  prompt: string | null;
  finalMessage: string | null;
  verdict: Verdict;
  verdictSummary: string | null;
  verdictDetails: string | null;
  error: string | null;
  totalDurationMs: number;
  startTime: number;
};

const API_BASE = "http://localhost:4001";

function buildFrameUrls(turns: Turn[]): string[] {
  const frames: string[] = [];
  for (const t of turns) {
    // Skip turn 1 and turn 2 input — first screenshots are always blank
    if (t.turn <= 1) continue;
    if (t.turn > 2 && t.inputScreenshotUrl) frames.push(API_BASE + t.inputScreenshotUrl);
    for (const url of t.actionScreenshotUrls ?? []) {
      frames.push(API_BASE + url);
    }
    if (t.resultScreenshotUrl) frames.push(API_BASE + t.resultScreenshotUrl);
  }
  return frames;
}

function emptyRunData(): RunData {
  return {
    runState: "idle",
    turns: [],
    prompt: null,
    finalMessage: null,
    verdict: null,
    verdictSummary: null,
    verdictDetails: null,
    error: null,
    totalDurationMs: 0,
    startTime: 0,
  };
}

export default function Home() {
  // Currently viewed run
  const [viewedRunId, setViewedRunId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"live" | "history">("live");
  const [maxTurns] = useState(20);

  // Displayed run state (for whichever run is currently viewed)
  const [displayed, setDisplayed] = useState<RunData>(emptyRunData());

  // Track all active run EventSources and their state
  const activeRunsRef = useRef<Map<string, {
    eventSource: EventSource;
    data: RunData;
  }>>(new Map());

  // Helper to update displayed state if this run is currently viewed
  const updateDisplayedIfViewed = useCallback((runId: string, updater: (d: RunData) => RunData) => {
    const entry = activeRunsRef.current.get(runId);
    if (entry) {
      entry.data = updater(entry.data);
    }
    setViewedRunId((currentViewedId) => {
      if (currentViewedId === runId) {
        setDisplayed((prev) => updater(prev));
      }
      return currentViewedId;
    });
  }, []);

  const handleRun = useCallback(
    async (prompt: string) => {
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

        const runData: RunData = {
          runState: "running",
          turns: [],
          prompt,
          finalMessage: null,
          verdict: null,
          verdictSummary: null,
          verdictDetails: null,
          error: null,
          totalDurationMs: 0,
          startTime: Date.now(),
        };

        // Switch view to the new run
        setViewMode("live");
        setViewedRunId(id);
        setDisplayed(runData);

        // Connect SSE
        const es = new EventSource(`${API_BASE}/api/run/${id}/events`);

        activeRunsRef.current.set(id, { eventSource: es, data: runData });

        es.onmessage = (event) => {
          try {
            const parsed = JSON.parse(event.data);

            if (parsed.type === "turn") {
              const turn = parsed.data as Turn;
              updateDisplayedIfViewed(id, (prev) => {
                const idx = prev.turns.findIndex((t) => t.turn === turn.turn);
                let newTurns: Turn[];
                if (idx >= 0) {
                  newTurns = [...prev.turns];
                  newTurns[idx] = turn;
                } else {
                  newTurns = [...prev.turns, turn];
                }
                return { ...prev, turns: newTurns };
              });
            } else if (parsed.type === "run_complete") {
              updateDisplayedIfViewed(id, (prev) => ({
                ...prev,
                runState: parsed.data.state,
                finalMessage: parsed.data.finalMessage,
                verdict: parsed.data.verdict ?? null,
                verdictSummary: parsed.data.verdictSummary ?? null,
                verdictDetails: parsed.data.verdictDetails ?? null,
                error: parsed.data.error,
                totalDurationMs: Date.now() - prev.startTime,
              }));
              es.close();
              activeRunsRef.current.delete(id);
            }
          } catch {
            // ignore parse errors
          }
        };

        es.onerror = () => {
          es.close();
          updateDisplayedIfViewed(id, (prev) => ({
            ...prev,
            runState: prev.runState === "running" ? "fail" : prev.runState,
          }));
          activeRunsRef.current.delete(id);
        };
      } catch (err) {
        setDisplayed((prev) => ({
          ...prev,
          runState: "fail",
          error: (err as Error).message,
        }));
      }
    },
    [maxTurns, updateDisplayedIfViewed],
  );

  const handleStop = useCallback(async () => {
    if (viewedRunId) {
      try {
        await fetch(`${API_BASE}/api/run/${viewedRunId}/stop`, { method: "POST" });
      } catch { /* ignore */ }
      const entry = activeRunsRef.current.get(viewedRunId);
      if (entry) {
        entry.eventSource.close();
        activeRunsRef.current.delete(viewedRunId);
      }
    }
  }, [viewedRunId]);

  const handleSelectRun = useCallback(async (id: string) => {
    // If this is an active run we're tracking, switch to its live state
    const active = activeRunsRef.current.get(id);
    if (active) {
      setViewMode("live");
      setViewedRunId(id);
      setDisplayed(active.data);
      window.scrollTo({ top: 0 });
      return;
    }

    // Otherwise fetch from server (completed or in-progress on another session)
    try {
      const res = await fetch(`${API_BASE}/api/run/${id}/data`);
      if (!res.ok) return;
      const data = await res.json();

      const isRunning = data.state === "running";

      const runData: RunData = {
        runState: data.state,
        turns: data.turns ?? [],
        prompt: data.prompt ?? null,
        finalMessage: data.finalMessage ?? null,
        verdict: data.verdict ?? null,
        verdictSummary: data.verdictSummary ?? null,
        verdictDetails: data.verdictDetails ?? null,
        error: data.error ?? null,
        totalDurationMs: data.startedAt && data.finishedAt
          ? new Date(data.finishedAt).getTime() - new Date(data.startedAt).getTime()
          : 0,
        startTime: data.startedAt ? new Date(data.startedAt).getTime() : 0,
      };

      setViewedRunId(id);
      setDisplayed(runData);

      if (isRunning) {
        // Connect SSE for live updates
        setViewMode("live");
        const es = new EventSource(`${API_BASE}/api/run/${id}/events`);
        activeRunsRef.current.set(id, { eventSource: es, data: runData });

        es.onmessage = (event) => {
          try {
            const parsed = JSON.parse(event.data);
            if (parsed.type === "turn") {
              const turn = parsed.data as Turn;
              updateDisplayedIfViewed(id, (prev) => {
                const idx = prev.turns.findIndex((t) => t.turn === turn.turn);
                let newTurns: Turn[];
                if (idx >= 0) {
                  newTurns = [...prev.turns];
                  newTurns[idx] = turn;
                } else {
                  newTurns = [...prev.turns, turn];
                }
                return { ...prev, turns: newTurns };
              });
            } else if (parsed.type === "run_complete") {
              updateDisplayedIfViewed(id, (prev) => ({
                ...prev,
                runState: parsed.data.state,
                finalMessage: parsed.data.finalMessage,
                verdict: parsed.data.verdict ?? null,
                verdictSummary: parsed.data.verdictSummary ?? null,
                verdictDetails: parsed.data.verdictDetails ?? null,
                error: parsed.data.error,
                totalDurationMs: Date.now() - prev.startTime,
              }));
              es.close();
              activeRunsRef.current.delete(id);
            }
          } catch { /* ignore */ }
        };

        es.onerror = () => {
          es.close();
          activeRunsRef.current.delete(id);
        };
      } else {
        setViewMode("history");
      }

      window.scrollTo({ top: 0 });
    } catch { /* ignore */ }
  }, [updateDisplayedIfViewed]);

  const handleNewRun = useCallback(() => {
    setViewMode("live");
    setViewedRunId(null);
    setDisplayed(emptyRunData());
  }, []);

  const { runState, turns, prompt, verdict, verdictSummary, verdictDetails, error, totalDurationMs } = displayed;
  const currentTurn = turns.length > 0 ? turns[turns.length - 1].turn : 0;
  const isFinished = runState === "completed" || runState === "fail" || runState === "stuck";
  const videoUrl = viewedRunId ? `${API_BASE}/api/run/${viewedRunId}/video` : null;
  const isViewingActiveRun = viewedRunId !== null && activeRunsRef.current.has(viewedRunId);

  return (
    <div className="app-layout">
      <RunHistory
        activeRunId={null}
        selectedRunId={viewedRunId}
        onSelectRun={handleSelectRun}
        onNewRun={handleNewRun}
      />

      <div className="app">
        <header className="app-header">
          <h1>QA Agent</h1>
        </header>

        <div className="app-body">
          <PromptBar
            onRun={handleRun}
            onStop={handleStop}
            isRunning={runState === "running" && isViewingActiveRun}
          />

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
