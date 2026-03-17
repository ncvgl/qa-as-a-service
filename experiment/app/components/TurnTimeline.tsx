"use client";

import { useEffect, useRef, useState, useCallback } from "react";
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
  actionScreenshotUrls: string[];
  pageUrl: string;
  pageTitle: string;
  tokenUsage: { input: number; output: number; reasoning: number };
  durationMs: number;
  apiDurationMs: number;
};

type Props = {
  turns: Turn[];
};

type LightboxState = {
  urls: string[];
  index: number;
} | null;

export default function TurnTimeline({ turns }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [lightbox, setLightbox] = useState<LightboxState>(null);

  // Auto-scroll to bottom on new turns
  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [turns.length]);

  const handleScreenshotClick = useCallback((urls: string[], index: number) => {
    setLightbox({ urls, index });
  }, []);

  const handlePrev = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setLightbox((prev) =>
      prev && prev.index > 0 ? { ...prev, index: prev.index - 1 } : prev,
    );
  }, []);

  const handleNext = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setLightbox((prev) =>
      prev && prev.index < prev.urls.length - 1
        ? { ...prev, index: prev.index + 1 }
        : prev,
    );
  }, []);

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
            onScreenshotClick={handleScreenshotClick}
          />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Lightbox with arrow navigation */}
      {lightbox && (
        <div
          className="lightbox-overlay"
          onClick={() => setLightbox(null)}
        >
          {lightbox.index > 0 && (
            <button className="lightbox-arrow lightbox-arrow-left" onClick={handlePrev}>
              &#8249;
            </button>
          )}
          <img src={lightbox.urls[lightbox.index]} alt="Screenshot" />
          {lightbox.index < lightbox.urls.length - 1 && (
            <button className="lightbox-arrow lightbox-arrow-right" onClick={handleNext}>
              &#8250;
            </button>
          )}
          <span className="lightbox-counter">
            {lightbox.index + 1} / {lightbox.urls.length}
          </span>
        </div>
      )}
    </>
  );
}
