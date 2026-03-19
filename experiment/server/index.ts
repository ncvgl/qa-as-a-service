import Fastify from "fastify";
import cors from "@fastify/cors";
import * as path from "node:path";
import * as fs from "node:fs";
import { v4 as uuid } from "uuid";
import { runAgent, stopRun, getScreenshotDir } from "./agent-loop.js";
import type { Run, RunMeta, SSEEvent } from "./types.js";

const PORT = Number(process.env.PORT ?? 4001);
const HOST = process.env.HOST ?? "0.0.0.0";

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });

// ── In-memory store ──

const runs = new Map<string, Run>();
const sseClients = new Map<string, Set<(event: SSEEvent) => void>>();

function broadcast(runId: string, event: SSEEvent) {
  const clients = sseClients.get(runId);
  if (clients) {
    for (const send of clients) {
      send(event);
    }
  }

  // Keep run state in sync
  const stored = runs.get(runId);
  if (!stored) return;

  if (event.type === "turn") {
    const idx = stored.turns.findIndex((t) => t.turn === event.data.turn);
    if (idx >= 0) {
      stored.turns[idx] = event.data;
    } else {
      stored.turns.push(event.data);
    }
  } else if (event.type === "run_complete") {
    stored.state = event.data.state;
    stored.finalMessage = event.data.finalMessage;
    stored.error = event.data.error;
    stored.finishedAt = new Date().toISOString();
  }
}

// ── Routes ──

// Start a new run
app.post<{
  Body: { prompt: string; maxTurns?: number };
}>("/api/run", async (request, reply) => {
  const { prompt, maxTurns = 20 } = request.body ?? {};

  if (!prompt || typeof prompt !== "string") {
    return reply.status(400).send({ error: "prompt is required" });
  }

  const runId = uuid();

  const run: Run = {
    id: runId,
    prompt,
    state: "running",
    turns: [],
    startedAt: new Date().toISOString(),
    finishedAt: null,
    finalMessage: null,
    maxTurns,
    error: null,
  };
  runs.set(runId, run);

  // Start agent in background — uses the same runId
  runAgent(runId, prompt, maxTurns, (event) => broadcast(runId, event)).catch(
    (err) => {
      console.error(`Run ${runId} failed:`, err);
    },
  );

  return reply.send({ runId });
});

// SSE event stream
app.get<{
  Params: { id: string };
}>("/api/run/:id/events", async (request, reply) => {
  const { id } = request.params;

  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });

  // Send existing turns as catch-up
  const run = runs.get(id);
  if (run) {
    for (const turn of run.turns) {
      reply.raw.write(`data: ${JSON.stringify({ type: "turn", data: turn })}\n\n`);
    }
    if (run.state !== "running" && run.state !== "idle") {
      reply.raw.write(
        `data: ${JSON.stringify({
          type: "run_complete",
          data: {
            state: run.state,
            finalMessage: run.finalMessage,
            error: run.error,
            totalTurns: run.turns.length,
          },
        })}\n\n`,
      );
      reply.raw.end();
      return;
    }
  }

  // Register for live events
  const send = (event: SSEEvent) => {
    try {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
      if (event.type === "run_complete") {
        reply.raw.end();
      }
    } catch {
      /* client disconnected */
    }
  };

  if (!sseClients.has(id)) {
    sseClients.set(id, new Set());
  }
  sseClients.get(id)!.add(send);

  request.raw.on("close", () => {
    const clients = sseClients.get(id);
    if (clients) {
      clients.delete(send);
      if (clients.size === 0) {
        sseClients.delete(id);
      }
    }
  });
});

// Serve screenshots
app.get<{
  Params: { id: string; filename: string };
}>("/api/run/:id/screenshots/:filename", async (request, reply) => {
  const { id, filename } = request.params;
  const filePath = path.join(getScreenshotDir(id), filename);

  if (fs.existsSync(filePath)) {
    return reply.type("image/png").send(fs.readFileSync(filePath));
  }

  return reply.status(404).send({ error: "Screenshot not found" });
});

// Serve run video (MP4)
app.get<{
  Params: { id: string };
}>("/api/run/:id/video", async (request, reply) => {
  const { id } = request.params;
  const mp4Path = path.join(getScreenshotDir(id), "run.mp4");

  if (fs.existsSync(mp4Path)) {
    return reply.type("video/mp4").send(fs.readFileSync(mp4Path));
  }

  return reply.status(404).send({ error: "Video not found" });
});

// List all completed runs
app.get("/api/runs", async (_request, reply) => {
  const screenshotsBase = path.join(process.cwd(), "screenshots");
  if (!fs.existsSync(screenshotsBase)) {
    return reply.send([]);
  }

  const entries = fs.readdirSync(screenshotsBase, { withFileTypes: true });
  const metas: RunMeta[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const runJsonPath = path.join(screenshotsBase, entry.name, "run.json");
    if (!fs.existsSync(runJsonPath)) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(runJsonPath, "utf-8"));
      metas.push({
        id: raw.id,
        prompt: raw.prompt,
        state: raw.state,
        verdict: raw.verdict ?? null,
        verdictSummary: raw.verdictSummary ?? null,
        startedAt: raw.startedAt,
        finishedAt: raw.finishedAt,
        totalTurns: raw.turns?.length ?? 0,
        error: raw.error,
      });
    } catch { /* skip malformed files */ }
  }

  // Sort by startedAt descending (most recent first)
  metas.sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""));
  return reply.send(metas);
});

// Get full run data
app.get<{
  Params: { id: string };
}>("/api/run/:id/data", async (request, reply) => {
  const { id } = request.params;
  const runJsonPath = path.join(getScreenshotDir(id), "run.json");

  if (fs.existsSync(runJsonPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(runJsonPath, "utf-8"));
      return reply.send(data);
    } catch {
      return reply.status(500).send({ error: "Failed to parse run data" });
    }
  }

  return reply.status(404).send({ error: "Run not found" });
});

// Stop a run
app.post<{
  Params: { id: string };
}>("/api/run/:id/stop", async (request, reply) => {
  const { id } = request.params;
  const stopped = stopRun(id);
  return stopped
    ? reply.send({ ok: true })
    : reply.status(404).send({ error: "Run not found or already finished" });
});

// ── Start ──

try {
  await app.listen({ port: PORT, host: HOST });
  console.log(`Server running on http://${HOST}:${PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
