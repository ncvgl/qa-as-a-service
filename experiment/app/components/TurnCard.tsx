"use client";

import { useState } from "react";

const API_BASE = "http://localhost:4001";
function resolveUrl(url: string): string {
  if (!url) return url;
  return url.startsWith("/") ? API_BASE + url : url;
}

type TurnStatus = "running" | "completed" | "stuck" | "error";

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

type Props = {
  turn: Turn;
  onScreenshotClick: (urls: string[], index: number) => void;
};

function formatTokens(n: number): string {
  if (n === 0) return "0";
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function formatDuration(ms: number): string {
  if (ms === 0) return "...";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function extractReasoning(rawOutput: Array<Record<string, unknown>>): string | null {
  const parts: string[] = [];
  for (const item of rawOutput) {
    if (item.type === "reasoning") {
      const summary = item.summary as Array<Record<string, unknown>> | undefined;
      if (summary) {
        for (const s of summary) {
          if (s.type === "summary_text" && s.text) parts.push(String(s.text).replace(/\*\*/g, ""));
        }
      }
    }
  }
  return parts.length > 0 ? parts.join("\n") : null;
}

function extractFinalAnswer(rawOutput: Array<Record<string, unknown>>): string | null {
  for (const item of rawOutput) {
    if (item.type === "message") {
      const content = item.content as Array<Record<string, unknown>> | undefined;
      if (content) {
        const texts = content
          .filter((c) => c.type === "output_text")
          .map((c) => String(c.text ?? ""));
        if (texts.length > 0) return texts.join("\n");
      }
    }
  }
  return null;
}

export default function TurnCard({ turn, onScreenshotClick }: Props) {
  const [rawExpanded, setRawExpanded] = useState(false);
  const [inputExpanded, setInputExpanded] = useState(false);
  const isRunning = turn.status === "running";
  const hasModelOutput = (turn.rawModelOutput && turn.rawModelOutput.length > 0) || turn.modelResponse.message;
  const reasoning = extractReasoning(turn.rawModelOutput ?? []);
  const finalAnswer = extractFinalAnswer(turn.rawModelOutput ?? []);

  return (
    <div className="turn-card">
      {/* Header row */}
      <div className="turn-card-header">
        <div className="turn-card-header-left">
          <span className="turn-label">Turn {turn.turn}</span>
          <span className={`status-badge ${turn.status}`}>{turn.status}</span>
        </div>
        <div className="turn-card-header-right">
        </div>
      </div>

      {/* Stats bar */}
      <div className="turn-stats-bar">
        <div className="turn-stat">
          <span className="turn-stat-label">Input Tokens</span>
          <span className="turn-stat-value">{formatTokens(turn.tokenUsage.input)}</span>
        </div>
        <div className="turn-stat">
          <span className="turn-stat-label">Output Tokens</span>
          <span className="turn-stat-value">{formatTokens(turn.tokenUsage.output)}</span>
        </div>
        <div className="turn-stat">
          <span className="turn-stat-label">Reasoning Tokens</span>
          <span className="turn-stat-value">{formatTokens(turn.tokenUsage.reasoning)}</span>
        </div>
        <div className="turn-stat">
          <span className="turn-stat-label">API Response</span>
          <span className="turn-stat-value">{formatDuration(turn.apiDurationMs)}</span>
        </div>
        <div className="turn-stat">
          <span className="turn-stat-label">Total</span>
          <span className="turn-stat-value">{formatDuration(turn.durationMs)}</span>
        </div>
      </div>

      <div className="turn-card-body">
        {/* Input sent — collapsed by default */}
        <div className="turn-section">
          <button
            className="turn-raw-toggle"
            onClick={() => setInputExpanded((prev) => !prev)}
          >
            {inputExpanded ? "▾" : "▸"} Input sent to API
          </button>
          {inputExpanded && (
            <div className="turn-input-text">{turn.inputText}</div>
          )}
        </div>

        {/* ── Raw API Output (collapsed by default) ── */}
        {hasModelOutput && (
          <div className="turn-section">
            <button
              className="turn-raw-toggle"
              onClick={() => setRawExpanded((prev) => !prev)}
            >
              {rawExpanded ? "▾" : "▸"} Raw API output
            </button>
            {rawExpanded && (
              <pre className="turn-raw-output">{JSON.stringify(turn.rawModelOutput, null, 2)}</pre>
            )}
          </div>
        )}

        {/* ── Model Reasoning ── */}
        {reasoning && (
          <div className="turn-section">
            <span className="turn-section-label turn-section-label-model">Model Reasoning</span>
            <ul className="turn-actions-list turn-actions-reasoning">
              {reasoning.split("\n").filter(Boolean).map((line, i) => (
                <li key={i}>
                  <code>{line}</code>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ── Final Answer ── */}
        {finalAnswer && (
          <div className="turn-section">
            <span className="turn-section-label turn-section-label-final">Final Answer</span>
            <div className="turn-final-answer" style={{ whiteSpace: "pre-wrap" }}>{finalAnswer}</div>
          </div>
        )}

        {/* ── Program Executed ── */}
        {turn.executedActions.length > 0 && (
          <div className="turn-section">
            <span className="turn-section-label turn-section-label-exec">
              Program Executed
              <span className="turn-section-count">{turn.executedActions.length} action{turn.executedActions.length !== 1 ? "s" : ""}</span>
            </span>
            <ul className="turn-actions-list turn-actions-exec">
              {turn.executedActions.map((action, i) => (
                <li key={i}>
                  <span className="turn-action-index">{i + 1}</span>
                  <code>{action}</code>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Loading indicator */}
        {isRunning && !hasModelOutput && turn.executedActions.length === 0 && (
          <div className="turn-section">
            <div className="turn-loading">
              <span className="turn-loading-dot" />
              Waiting for model response...
            </div>
          </div>
        )}

        {/* Screenshots — skip turn 1 (blank page) and text-only final turns (no actions) */}
        {turn.turn > 1 && turn.executedActions.length > 0 && (turn.inputScreenshotUrl || turn.resultScreenshotUrl) && (() => {
          // Build ordered list of all screenshots for this turn
          const allUrls: string[] = [];
          const labels: string[] = [];
          if (turn.inputScreenshotUrl) {
            allUrls.push(resolveUrl(turn.inputScreenshotUrl));
            labels.push("Before");
          }
          const actionUrls = turn.actionScreenshotUrls ?? [];
          for (let i = 0; i < actionUrls.length; i++) {
            allUrls.push(resolveUrl(actionUrls[i]));
            labels.push(`After ${i + 1}`);
          }
          if (turn.resultScreenshotUrl && actionUrls.length === 0) {
            allUrls.push(resolveUrl(turn.resultScreenshotUrl));
            labels.push("After");
          }
          return (
            <div className="turn-section">
              <div className="turn-screenshots">
                {allUrls.map((url, i) => (
                  <div className="turn-screenshot-wrapper" key={i}>
                    <span className="turn-screenshot-label">{labels[i]}</span>
                    <img
                      className="turn-screenshot"
                      src={url}
                      alt={`Turn ${turn.turn} ${labels[i]}`}
                      onClick={() => onScreenshotClick(allUrls, i)}
                      loading="lazy"
                    />
                  </div>
                ))}
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
