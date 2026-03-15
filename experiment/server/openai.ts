import OpenAI from "openai";
import type { ModelResult, ComputerAction } from "./types.js";

const MODEL = process.env.CUA_DEFAULT_MODEL ?? "gpt-5.4";

const COMPUTER_TOOL = {
  type: "computer" as const,
};

const GOTO_URL_TOOL = {
  type: "function" as const,
  name: "goto_url",
  description:
    "Navigate the browser to a URL. Use this to open websites. The page will be fully loaded before returning.",
  strict: true,
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      url: {
        type: "string",
        description: "The URL to navigate to (e.g. https://example.com).",
      },
    },
    required: ["url"],
  },
};

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
    client = new OpenAI({ apiKey });
  }
  return client;
}

export type CallModelParams = {
  input: unknown;
  instructions: string;
  previousResponseId?: string;
  signal?: AbortSignal;
  includeGotoUrl?: boolean;
};

export type FullModelResult = ModelResult & {
  responseId: string;
  rawOutput: Array<Record<string, unknown>>;
};

export async function callModel(params: CallModelParams): Promise<FullModelResult> {
  const { input, instructions, previousResponseId, signal, includeGotoUrl = true } = params;
  const openai = getClient();

  const tools = includeGotoUrl
    ? [COMPUTER_TOOL, GOTO_URL_TOOL]
    : [COMPUTER_TOOL];

  const request: Record<string, unknown> = {
    model: MODEL,
    instructions,
    input,
    tools,
    parallel_tool_calls: false,
    reasoning: { effort: "medium", summary: "concise" },
    truncation: "auto",
  };

  if (previousResponseId) {
    request.previous_response_id = previousResponseId;
  }

  const response = await openai.responses.create(request, { signal });

  const raw = response as unknown as Record<string, unknown>;
  const rawOutput = (raw.output as Array<Record<string, unknown>>) ?? [];

  const result = parseResponse(raw);
  return {
    ...result,
    responseId: String(raw.id ?? ""),
    rawOutput,
  };
}

/**
 * Build the tool output items to send back after executing actions.
 */
export function buildToolOutputs(
  rawOutput: Array<Record<string, unknown>>,
  screenshotDataUrl: string,
  functionResults: Map<string, string>,
): Array<Record<string, unknown>> {
  const outputs: Array<Record<string, unknown>> = [];

  for (const item of rawOutput) {
    if (item.type === "computer_call") {
      outputs.push({
        type: "computer_call_output",
        call_id: item.call_id,
        output: {
          type: "computer_screenshot",
          image_url: screenshotDataUrl,
          detail: "original",
        },
      });
    } else if (item.type === "function_call") {
      const callId = item.call_id as string;
      outputs.push({
        type: "function_call_output",
        call_id: callId,
        output: functionResults.get(callId) ?? "done",
      });
    }
  }

  return outputs;
}

function parseResponse(response: Record<string, unknown>): ModelResult {
  const output = (response.output as Array<Record<string, unknown>>) ?? [];
  const usage = response.usage as Record<string, unknown> | null;

  const actions: ComputerAction[] = [];
  const functionCalls: Array<{
    name: string;
    args: Record<string, unknown>;
    callId: string;
  }> = [];
  let message: string | null = null;

  for (const item of output) {
    const itemType = item.type as string;

    if (itemType === "computer_call") {
      // Single action per computer_call in stateful mode
      const action = item.action as ComputerAction | undefined;
      if (action) {
        actions.push(action);
      }
      // Also check batched actions
      const batchedActions = item.actions as ComputerAction[] | undefined;
      if (batchedActions) {
        actions.push(...batchedActions);
      }
    } else if (itemType === "function_call") {
      const name = item.name as string;
      const callId = String(item.call_id ?? "");
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(String(item.arguments ?? "{}"));
      } catch {
        // ignore parse errors
      }
      functionCalls.push({ name, args, callId });
    } else if (itemType === "message") {
      const content = item.content as Array<Record<string, unknown>> | undefined;
      if (content) {
        const textParts = content
          .filter((c) => c.type === "output_text")
          .map((c) => String(c.text ?? ""));
        if (textParts.length > 0) {
          message = textParts.join("\n");
        }
      }
    }
  }

  const outputDetails = (usage?.output_tokens_details as Record<string, unknown>) ?? {};

  return {
    actions,
    functionCalls,
    message,
    usage: {
      input: Number(usage?.input_tokens ?? 0),
      output: Number(usage?.output_tokens ?? 0),
      reasoning: Number(outputDetails?.reasoning_tokens ?? 0),
    },
  };
}

export { MODEL };
