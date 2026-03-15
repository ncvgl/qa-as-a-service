"use client";

import { useEffect, useRef, useState } from "react";
import TurnCard from "./TurnCard";

type Turn = {
  turn: number;
  status: "running" | "completed" | "stuck" | "error";
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

type Props = {
  turns: Turn[];
};

export default function TurnTimeline({ turns }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  // Auto-scroll to bottom on new turns
  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [turns.length]);

  if (turns.length === 0) {
    return (
      <div className="turn-timeline">
        <div className="turn-timeline-empty">
          Enter a prompt and click Run to start the agent.
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="turn-timeline">
        {turns.map((turn) => (
          <TurnCard
            key={turn.turn}
            turn={turn}
            onScreenshotClick={(url) => setLightboxUrl(url)}
          />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Lightbox */}
      {lightboxUrl && (
        <div
          className="lightbox-overlay"
          onClick={() => setLightboxUrl(null)}
        >
          <img src={lightboxUrl} alt="Screenshot" />
        </div>
      )}
    </>
  );
}
