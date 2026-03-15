"use client";

import { useState, useRef, useCallback } from "react";
import PromptBar from "./components/PromptBar";
import RunStatus from "./components/RunStatus";
import TurnTimeline from "./components/TurnTimeline";

type TurnStatus = "running" | "completed" | "stuck" | "error";
type RunState = "idle" | "running" | "completed" | "failed" | "stuck";

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
  pageUrl: string;
  pageTitle: string;
  tokenUsage: { input: number; output: number; reasoning: number };
  durationMs: number;
};

export default function Home() {
  const [runState, setRunState] = useState<RunState>("idle");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [maxTurns] = useState(20);
  const [finalMessage, setFinalMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [totalDurationMs, setTotalDurationMs] = useState<number>(0);
  const eventSourceRef = useRef<EventSource | null>(null);
  const runStartTimeRef = useRef<number>(0);

  const currentTurn = turns.length > 0 ? turns[turns.length - 1].turn : 0;

  const handleRun = useCallback(
    async (prompt: string) => {
      // Close any existing SSE connection
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }

      // Reset state
      setTurns([]);
      setRunState("running");
      setFinalMessage(null);
      setError(null);
      runStartTimeRef.current = Date.now();
      setTotalDurationMs(0);

      try {
        const res = await fetch("http://localhost:4001/api/run", {
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
        const es = new EventSource(`http://localhost:4001/api/run/${id}/events`);
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
            prev === "running" ? "failed" : prev,
          );
        };
      } catch (err) {
        setRunState("failed");
        setError((err as Error).message);
      }
    },
    [maxTurns],
  );

  const handleStop = useCallback(async () => {
    if (runId) {
      try {
        await fetch(`http://localhost:4001/api/run/${runId}/stop`, { method: "POST" });
      } catch {
        // ignore
      }
    }
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  }, [runId]);

  return (
    <div className="app">
      <header className="app-header">
        <h1>CUA Agent</h1>
        <p>Computer Use Agent — autonomous browser automation</p>
      </header>

      <div className="app-body">
        <PromptBar
          onRun={handleRun}
          onStop={handleStop}
          isRunning={runState === "running"}
        />

        <RunStatus
          state={runState}
          currentTurn={currentTurn}
          maxTurns={maxTurns}
          finalMessage={finalMessage}
          error={error}
          totalDurationMs={totalDurationMs}
        />

        <TurnTimeline turns={turns} />
      </div>
    </div>
  );
}
