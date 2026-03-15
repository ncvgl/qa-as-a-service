"use client";

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
  pageUrl: string;
  pageTitle: string;
  tokenUsage: { input: number; output: number; reasoning: number };
  durationMs: number;
};

type Props = {
  turn: Turn;
  onScreenshotClick: (url: string) => void;
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

export default function TurnCard({ turn, onScreenshotClick }: Props) {
  const isRunning = turn.status === "running";
  const hasModelOutput = (turn.rawModelOutput && turn.rawModelOutput.length > 0) || turn.modelResponse.message;

  return (
    <div className="turn-card">
      {/* Header row */}
      <div className="turn-card-header">
        <div className="turn-card-header-left">
          <span className="turn-label">Turn {turn.turn}</span>
          <span className={`status-badge ${turn.status}`}>{turn.status}</span>
        </div>
        <div className="turn-card-header-right">
          {turn.pageUrl && turn.pageUrl !== "about:blank" && (
            <span className="turn-page-info">
              {turn.pageTitle || turn.pageUrl}
            </span>
          )}
          <span className="turn-duration">{formatDuration(turn.durationMs)}</span>
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
        {turn.tokenUsage.reasoning > 0 && (
          <div className="turn-stat">
            <span className="turn-stat-label">Reasoning Tokens</span>
            <span className="turn-stat-value">{formatTokens(turn.tokenUsage.reasoning)}</span>
          </div>
        )}
        <div className="turn-stat">
          <span className="turn-stat-label">Duration</span>
          <span className="turn-stat-value">{formatDuration(turn.durationMs)}</span>
        </div>
      </div>

      <div className="turn-card-body">
        {/* Input sent — always visible */}
        <div className="turn-section">
          <span className="turn-section-label">Input Sent to Model</span>
          <div className="turn-input-text">{turn.inputText}</div>
        </div>

        {/* ── Raw Model Output ── */}
        {hasModelOutput && (
          <div className="turn-section">
            <span className="turn-section-label turn-section-label-model">
              Model Response (raw API output)
            </span>
            <pre className="turn-raw-output">{JSON.stringify(turn.rawModelOutput, null, 2)}</pre>
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

        {/* Screenshots */}
        {(turn.inputScreenshotUrl || turn.resultScreenshotUrl) && (
          <div className="turn-section">
            <span className="turn-section-label">Screenshots</span>
            <div className="turn-screenshots">
              {turn.inputScreenshotUrl && (
                <div className="turn-screenshot-wrapper">
                  <span className="turn-screenshot-label">Before</span>
                  <img
                    className="turn-screenshot"
                    src={turn.inputScreenshotUrl}
                    alt={`Turn ${turn.turn} input`}
                    onClick={() => onScreenshotClick(turn.inputScreenshotUrl)}
                    loading="lazy"
                  />
                </div>
              )}
              {turn.resultScreenshotUrl && (
                <div className="turn-screenshot-wrapper">
                  <span className="turn-screenshot-label">After</span>
                  <img
                    className="turn-screenshot"
                    src={turn.resultScreenshotUrl}
                    alt={`Turn ${turn.turn} result`}
                    onClick={() => onScreenshotClick(turn.resultScreenshotUrl)}
                    loading="lazy"
                  />
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
