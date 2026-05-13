# Experiment: Clean CUA Agent App

## Context

The existing `openai-cua-sample-app` is a complex monorepo with modes, scenarios, and abstractions we don't need. We're building a focused, minimal CUA agent from scratch that does one thing well: take a prompt, run it autonomously in a visible browser, and show every step clearly.

## Architecture

Single project at `/Users/mugen/Codebase/qaas/experiment/` with a Fastify backend and Next.js frontend.

```
experiment/
├── package.json
├── tsconfig.json
├── server/
│   ├── index.ts          # Fastify server entry
│   ├── agent-loop.ts     # The core agent loop
│   ├── browser.ts        # Playwright launch + actions
│   ├── openai.ts         # OpenAI Responses API client
│   ├── stuck-detector.ts # Screenshot similarity comparison
│   └── types.ts          # Shared types
├── app/                  # Next.js app directory
│   ├── layout.tsx
│   ├── page.tsx          # Main UI
│   ├── globals.css
│   └── components/
│       ├── PromptBar.tsx     # Prompt input + preset dropdown + Run button
│       ├── TurnTimeline.tsx  # Vertical list of TurnCard components
│       ├── TurnCard.tsx      # Single turn: input sent, model response, actions, screenshot, status
│       └── RunStatus.tsx     # Overall run status banner
├── next.config.mjs
└── .env                  # Symlink or copy from parent
```

## Data Model

### Turn (stored per turn, sent to frontend via SSE)

```ts
type TurnStatus = "running" | "completed" | "stuck" | "error";

type Turn = {
  turn: number;
  status: TurnStatus;
  inputText: string;
  inputScreenshotUrl: string;
  modelResponse: {
    actions: ComputerAction[];
    functionCalls: { name: string; args: Record<string, unknown> }[];
    message: string | null;
  };
  executedActions: string[];
  resultScreenshotUrl: string;
  pageUrl: string;
  pageTitle: string;
  tokenUsage: { input: number; output: number; reasoning: number };
  durationMs: number;
  createdAt: string;
};

type RunState = "idle" | "running" | "completed" | "failed" | "stuck";

type Run = {
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
```

## Agent Loop (server/agent-loop.ts)

```
async function runAgent(prompt, maxTurns, onTurnUpdate, onRunComplete):
  1. Launch browser (headful, 1440x900, about:blank)
  2. turnLog = []
  3. screenshotBuffers = []  // last 3 for stuck detection

  for turn = 1 to maxTurns:
    4. Capture screenshot → base64 data URL + save PNG to disk
    5. Build context summary from turnLog
    6. Build input: [{ role: "user", content: [input_text(prompt + summary), input_image(screenshot)] }]
    7. Emit turn start event via onTurnUpdate (includes inputText, inputScreenshotUrl)
    8. Call OpenAI Responses API (stateless, no previous_response_id)
    9. Parse response:
       - If no tool calls → final message → emit turn complete → break (success)
       - If function_call (goto_url) → page.goto(url) → record action
       - If computer_call → execute each action via Playwright → record actions
    10. Capture result screenshot → save PNG
    11. Check stuck: compare last 3 screenshots, if >90% similar → break (stuck)
    12. Build turn summary: "Turn N: action1, action2 — model text if any"
    13. Push to turnLog
    14. Emit turn complete event

  15. Close browser
  16. Emit run complete (success / max_turns_reached / stuck)
```

## SSE Events

```ts
type TurnEvent = {
  type: "turn";
  data: Turn;
};

type RunCompleteEvent = {
  type: "run_complete";
  data: {
    state: RunState;
    finalMessage: string | null;
    error: string | null;
    totalTurns: number;
  };
};
```

## API Endpoints

```
POST /api/run          # Start a run. Body: { prompt, maxTurns? }. Returns { runId } + starts SSE.
GET  /api/run/:id/events  # SSE stream of TurnEvent + RunCompleteEvent
GET  /api/run/:id/screenshots/:filename  # Serve screenshot PNGs
POST /api/run/:id/stop    # Cancel a running run
```

## Stuck Detection (server/stuck-detector.ts)

```ts
function compareScreenshots(buf1: Buffer, buf2: Buffer): number
  // Decode both PNGs to raw RGBA pixel arrays (use pngjs)
  // Compare pixel by pixel: count matching pixels (within small tolerance per channel)
  // Return ratio: matchingPixels / totalPixels

function isStuck(recentBuffers: Buffer[]): boolean
  // Need at least 3 buffers
  // Compare [n-2] vs [n-1] AND [n-1] vs [n]
  // If both > 0.90 → stuck
```

## Browser Actions (server/browser.ts)

- `launchBrowser()` → chromium.launch headful, 1440x900
- `executeAction(page, action)` → switch on action.type: click, double_click, type, keypress, scroll, drag, move, wait
- `captureScreenshot(page, dir, label)` → page.screenshot + save to disk + return { path, dataUrl }
- `normalizeKey(key)` → handle Ctrl/Cmd/Meta/Alt/Enter/etc.
- 120ms inter-action delay

## OpenAI Client (server/openai.ts)

- Initialize with `OPENAI_API_KEY` from env
- `callModel(input, instructions, tools, signal)` → responses.create()
- Tools: always `[computer, goto_url]`
- Model: `CUA_DEFAULT_MODEL` env or `"gpt-5.4"`
- Parse response into `{ actions, functionCalls, message, usage }`

## Frontend

### PromptBar
- Dropdown: "Custom" (default) + "Slawk DM Flow" preset
- Selecting preset fills the textarea
- Textarea for free-form prompt
- "Run" button (disabled while running)
- "Stop" button (visible while running)

### TurnTimeline
- Vertical list of TurnCard components, latest at bottom
- Auto-scrolls to bottom as new turns arrive

### TurnCard
Each card shows a single turn in a clear layout:
- **Header**: "Turn 3" + status badge + duration
- **Input sent**: Collapsible section showing the full text prompt sent
- **Screenshot sent**: Thumbnail of the screenshot that was sent to the model (clickable to expand)
- **Model response**: The actions returned (human-readable) + any text message
- **Actions executed**: List of what was actually run
- **Result screenshot**: Thumbnail of the screenshot after execution (clickable to expand)
- **Token usage**: Input/output/reasoning tokens

### RunStatus
- Banner at top showing: Idle / Running (turn X of max) / Completed / Failed / Stuck
- When complete: shows final model message

### Frontend → Backend connection
- POST /api/run to start
- EventSource on /api/run/:id/events for SSE
- Accumulate Turn objects in state, render TurnTimeline

## Dev Scripts

```
"dev": "concurrently -k -n server,web \"pnpm dev:server\" \"pnpm dev:web\"",
"dev:server": "node --env-file-if-exists=../.env --import tsx --watch server/index.ts",
"dev:web": "next dev --port 3002"
```

Server runs on port 4001, web on 3002. Next.js proxies /api to the Fastify server via next.config.mjs rewrites.

## Implementation Notes (discovered during build)

### Key finding: Stateful API with `previous_response_id`
The model (`gpt-5.4`) requires the stateful Responses API approach to use the `computer` tool effectively:
- First call sends `[{ role: "user", content: [input_text, input_image] }]`
- Subsequent calls send tool outputs (`computer_call_output` with screenshot, `function_call_output` with result text) and `previous_response_id`
- The model needs to see its own tool call outputs chained via response IDs

### Key finding: `goto_url` must be restricted to first turn
When `goto_url` is available on all turns, the model exclusively uses it (even to "refresh" a page that's already loaded). Restricting `goto_url` to turn 1 only forces the model to use the `computer` tool for interactions on turns 2+. This was the critical fix that made the agent work.

### Tool definition
- Computer tool: `{ type: "computer" }` (no display_width/height needed for gpt-5.4)
- Goto URL: standard function tool with `strict: true`

### OpenAI SDK
- Must use `openai@^6.25.0` (v6, not v5) — the Responses API changed between major versions
- Model: `gpt-5.4` (env `CUA_DEFAULT_MODEL`)
- Reasoning effort: `"medium"` (not `"low"` — low makes the model less capable)

### Verified working flow (6 turns)
1. `goto_url("https://www.google.com")` — initial navigation
2. `screenshot()` — model inspects the page
3. `click(818, 736)` — clicks "Accept all" on cookie dialog
4. `click(592, 401)` + `type("OpenAI CUA agent")` + `keypress(Enter)` — search
5. `wait(1000ms)` — waits for results
6. Final message: task complete
