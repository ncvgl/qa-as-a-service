// ── Computer Actions ──

export type ComputerAction = {
  type: string;
  x?: number;
  y?: number;
  button?: string | number;
  text?: string;
  key?: string;
  keys?: string[];
  delta_x?: number;
  deltaX?: number;
  delta_y?: number;
  deltaY?: number;
  scroll_y?: number;
  path?: Array<{ x: number; y: number }>;
  ms?: number;
  duration_ms?: number;
  url?: string;
  [key: string]: unknown;
};

// ── Turn ──

export type TurnStatus = "running" | "completed" | "stuck" | "error";

export type Turn = {
  turn: number;
  status: TurnStatus;
  inputText: string;
  inputScreenshotUrl: string;
  modelResponse: {
    actions: ComputerAction[];
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
  createdAt: string;
};

// ── Run ──

export type RunState = "idle" | "running" | "completed" | "failed" | "stuck";

export type Run = {
  id: string;
  prompt: string;
  state: RunState;
  turns: Turn[];
  startedAt: string;
  finishedAt: string | null;
  finalMessage: string | null;
  maxTurns: number;
  error: string | null;
};

// ── SSE Events ──

export type TurnEvent = {
  type: "turn";
  data: Turn;
};

export type RunCompleteEvent = {
  type: "run_complete";
  data: {
    state: RunState;
    finalMessage: string | null;
    error: string | null;
    totalTurns: number;
  };
};

export type SSEEvent = TurnEvent | RunCompleteEvent;

// ── Model Response ──

export type ModelResult = {
  actions: ComputerAction[];
  functionCalls: Array<{ name: string; args: Record<string, unknown>; callId: string }>;
  message: string | null;
  usage: { input: number; output: number; reasoning: number };
};
