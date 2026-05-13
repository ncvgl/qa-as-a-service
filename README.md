# QA as a Service

![Screenshot](screenshot.png)

Drive a real browser with OpenAI's Computer-Use model to execute end-to-end QA prompts and report results.

## Setup

```bash
pnpm install
pnpm exec playwright install chromium
```

Copy `.env.example` to `.env` and fill in your key:

```bash
cp .env.example .env
# then edit .env and set OPENAI_API_KEY=sk-...
```

## Start

```bash
pnpm dev
```

Starts backend on `:4001` and frontend on `:3002`.

## Frontend

Open <http://localhost:3002>. Pick a preset (or write a custom prompt), hit Run, watch the live screenshots and verdict. The history tab lists past runs.

## Backend API

The frontend is a thin client over a plain HTTP API — you can hit it directly.

```bash
# 1. Submit a job
curl -sX POST http://localhost:4001/api/run \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"Go to example.com and check the homepage loads."}'
# → {"runId":"<uuid>"}

# 2. Stream live progress (SSE, optional)
curl -N http://localhost:4001/api/run/<runId>/events

# 3. Fetch the full result (works during or after the run)
curl http://localhost:4001/api/run/<runId>/data
```

Other endpoints: `GET /api/runs` (list), `GET /api/run/:id/screenshots/:filename`, `GET /api/run/:id/video`, `POST /api/run/:id/stop`.

Completed runs are persisted to `screenshots/<runId>/run.json`.

## Parallel runs

Each `POST /api/run` spawns its own Playwright browser and returns immediately with a `runId`. Fire as many as your machine and OpenAI rate limits can handle:

```bash
for prompt in "Test login" "Test signup" "Test profile edit"; do
  curl -sX POST http://localhost:4001/api/run \
    -H 'Content-Type: application/json' \
    -d "{\"prompt\":\"$prompt\"}" &
done
wait
```

Poll `/api/run/:id/data` per `runId` for results.

## Specifying a device

There is no `device` API field — the target device is inferred from the prompt by `gpt-4o-mini`. Mention it explicitly:

```
Test on Pixel 7. Go to example.com and ...
```

Recognized presets: `desktop` (default), `iphone_14`, `iphone_14_pro_max`, `ipad_pro_11`, `pixel_7`, `galaxy_s23_ultra`, `galaxy_tab_s8`.

Device names that appear as test *content* (e.g. "search for iPhone specs") are ignored — only phrases like "test on X" / "on Pixel" change the emulated device.

## Project layout

```
app/         Next.js routes and UI
server/      Fastify API + agent loop + Playwright driver
screenshots/ Run artifacts and run.json files (gitignored)
```
