import { z } from "zod";
import type {
  DeepSeekAssistantResult,
  DeepSeekAssistantTool,
  DeepSeekConversationMessage,
} from "./deepseek";

const MAX_TOOL_ROUNDS = 2;
const MAX_TOOL_CALLS_PER_ROUND = 3;
const MAX_TOOL_OUTPUT_CHARS = 12_000;

type OllamaToolCall = {
  type?: "function";
  function: {
    name: string;
    arguments: unknown;
  };
};

type OllamaRequestMessage =
  | {
      role: "system" | "user";
      content: string;
    }
  | {
      role: "assistant";
      content?: string;
      tool_calls?: OllamaToolCall[];
    }
  | {
      role: "tool";
      tool_name: string;
      content: string;
    };

const ollamaToolCallSchema = z.object({
  type: z.literal("function").optional(),
  function: z.object({
    name: z.string().min(1),
    arguments: z.unknown().optional().default({}),
  }),
});

const ollamaChatResponseSchema = z.object({
  message: z.object({
    role: z.literal("assistant"),
    content: z.string().optional().default(""),
    tool_calls: z.array(ollamaToolCallSchema).optional(),
  }),
});

const ollamaErrorResponseSchema = z.object({
  error: z.string().optional(),
});

export class OllamaAssistantError extends Error {
  readonly kind:
    | "timeout"
    | "unavailable"
    | "model_not_found"
    | "upstream"
    | "invalid_response";

  constructor(
    kind:
      | "timeout"
      | "unavailable"
      | "model_not_found"
      | "upstream"
      | "invalid_response",
    message: string
  ) {
    super(message);
    this.kind = kind;
    this.name = "OllamaAssistantError";
  }
}

function parseToolArguments(raw: unknown): unknown {
  if (typeof raw === "string") {
    if (raw.length > 4_000) return null;
    try {
      return JSON.parse(raw || "{}");
    } catch {
      return null;
    }
  }
  if (raw && typeof raw === "object") return raw;
  return {};
}

function safeToolOutput(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (!serialized) return "{}";
  return serialized.slice(0, MAX_TOOL_OUTPUT_CHARS);
}

function cleanModelAnswer(content: string): string {
  let answer = content.trim();

  // Thinking-only Qwen tags can return the trace in message.content with only
  // a closing </think> marker. Keep only the final answer after the last one.
  const closingThinkTags = [...answer.matchAll(/<\/think>/gi)];
  const lastClosingThinkTag = closingThinkTags.at(-1);
  if (lastClosingThinkTag?.index !== undefined) {
    answer = answer.slice(
      lastClosingThinkTag.index + lastClosingThinkTag[0].length,
    );
  }

  answer = answer.replace(/<think>[\s\S]*?<\/think>\s*/gi, "").trim();

  // Never expose an unfinished reasoning block when generation stops early.
  if (/^<think>/i.test(answer)) return "";
  return answer;
}

function endpoint(baseUrl: string): string {
  try {
    return new URL("/api/chat", `${baseUrl.replace(/\/+$/, "")}/`).toString();
  } catch {
    throw new OllamaAssistantError("unavailable", "Ollama base URL is invalid");
  }
}

async function requestCompletion(input: {
  baseUrl: string;
  model: string;
  messages: OllamaRequestMessage[];
  tools: DeepSeekAssistantTool[];
  timeoutMs: number;
  fetchImpl: typeof fetch;
}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);

  try {
    const response = await input.fetchImpl(endpoint(input.baseUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: input.model,
        messages: input.messages,
        stream: false,
        think: false,
        keep_alive: "10m",
        options: {
          temperature: 0.2,
          num_predict: 1_200,
        },
        ...(input.tools.length
          ? { tools: input.tools.map(tool => tool.definition) }
          : {}),
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      let upstreamMessage = "";
      try {
        const payload = ollamaErrorResponseSchema.safeParse(
          await response.json()
        );
        upstreamMessage = payload.success ? (payload.data.error ?? "") : "";
      } catch {
        // Ollama may return plain text for proxy-level failures.
      }
      if (
        response.status === 404 ||
        /model.+(?:not found|missing)/i.test(upstreamMessage)
      ) {
        throw new OllamaAssistantError(
          "model_not_found",
          "Ollama model is not installed"
        );
      }
      throw new OllamaAssistantError(
        "upstream",
        `Ollama returned HTTP ${response.status}`
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new OllamaAssistantError(
        "invalid_response",
        "Ollama response was not JSON"
      );
    }
    const parsed = ollamaChatResponseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new OllamaAssistantError(
        "invalid_response",
        "Ollama response had an unexpected shape"
      );
    }
    return parsed.data.message;
  } catch (error) {
    if (error instanceof OllamaAssistantError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new OllamaAssistantError("timeout", "Ollama request timed out");
    }
    throw new OllamaAssistantError(
      "unavailable",
      "Could not connect to Ollama"
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Server-only Ollama gateway. It uses the same allowlisted read-only tools as
 * the hosted provider, but sends model requests to the configured local URL.
 */
export async function runOllamaAssistant(input: {
  baseUrl: string;
  model: string;
  systemPrompt: string;
  conversation: DeepSeekConversationMessage[];
  tools: DeepSeekAssistantTool[];
  forcedToolName?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<DeepSeekAssistantResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const toolsByName = new Map(
    input.tools.map(tool => [tool.definition.function.name, tool])
  );
  const forcedToolName =
    input.forcedToolName && toolsByName.has(input.forcedToolName)
      ? input.forcedToolName
      : undefined;
  const forcedToolInstruction = forcedToolName
    ? `\n\nสำหรับคำขอล่าสุด ต้องเรียกเครื่องมือ ${forcedToolName} ก่อนตอบ ห้ามเดาหรือสร้างข้อมูลเอง`
    : "";
  const messages: OllamaRequestMessage[] = [
    {
      role: "system",
      content: `${input.systemPrompt}${forcedToolInstruction}`,
    },
    ...input.conversation,
  ];

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
    const allowTools = round < MAX_TOOL_ROUNDS;
    const toolsForRound = allowTools
      ? round === 0 && forcedToolName
        ? input.tools.filter(
            tool => tool.definition.function.name === forcedToolName
          )
        : input.tools
      : [];
    const responseMessage = await requestCompletion({
      baseUrl: input.baseUrl,
      model: input.model,
      messages,
      tools: toolsForRound,
      timeoutMs: input.timeoutMs ?? 180_000,
      fetchImpl,
    });
    const toolCalls = allowTools
      ? (responseMessage.tool_calls ?? []).slice(0, MAX_TOOL_CALLS_PER_ROUND)
      : [];

    if (!toolCalls.length) {
      if (round === 0 && forcedToolName) {
        throw new OllamaAssistantError(
          "invalid_response",
          "Ollama did not call the required tool"
        );
      }
      const answer = cleanModelAnswer(responseMessage.content);
      if (!answer) {
        throw new OllamaAssistantError(
          "invalid_response",
          "Ollama returned an empty answer"
        );
      }
      return {
        answer: answer.slice(0, 8_000),
        containsPrivateToolData: false,
        actions: [],
      };
    }

    messages.push({
      role: "assistant",
      content: responseMessage.content,
      tool_calls: toolCalls,
    });
    const privateAnswers: string[] = [];
    const privateActions: DeepSeekAssistantResult["actions"] = [];

    for (const toolCall of toolCalls) {
      const toolName = toolCall.function.name;
      const tool = toolsByName.get(toolName);
      let output: unknown = { error: "tool_not_available" };
      if (tool) {
        const argumentsValue = parseToolArguments(toolCall.function.arguments);
        try {
          output = await tool.execute(argumentsValue);
          if (tool.renderPrivateResult) {
            const rendered = tool.renderPrivateResult(output);
            const privateAnswer =
              typeof rendered === "string"
                ? rendered.trim()
                : rendered.answer.trim();
            if (privateAnswer) privateAnswers.push(privateAnswer);
            if (typeof rendered !== "string") {
              privateActions.push(...rendered.actions);
            }
            output = { status: "handled_privately" };
          }
        } catch {
          output = { error: "invalid_tool_arguments" };
        }
      }
      messages.push({
        role: "tool",
        tool_name: toolName,
        content: safeToolOutput(output),
      });
    }

    if (privateAnswers.length) {
      return {
        answer: privateAnswers.join("\n\n").slice(0, 8_000),
        containsPrivateToolData: true,
        actions: privateActions.slice(0, 12),
      };
    }
  }

  throw new OllamaAssistantError(
    "invalid_response",
    "Ollama did not return a final answer"
  );
}
