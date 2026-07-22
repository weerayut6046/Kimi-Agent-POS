import { z } from "zod";
import type { AssistantAction } from "@contracts/assistant";

const DEEPSEEK_CHAT_URL = "https://api.deepseek.com/chat/completions";
const REQUEST_TIMEOUT_MS = 25_000;
const MAX_TOOL_ROUNDS = 2;
const MAX_TOOL_CALLS_PER_ROUND = 3;
const MAX_TOOL_OUTPUT_CHARS = 12_000;

export type DeepSeekConversationMessage = {
  role: "user" | "assistant";
  content: string;
};

export type DeepSeekAssistantResult = {
  answer: string;
  containsPrivateToolData: boolean;
  actions: AssistantAction[];
};

type DeepSeekToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

type DeepSeekToolChoice =
  | "auto"
  | "none"
  | {
      type: "function";
      function: { name: string };
    };

export type DeepSeekAssistantTool = {
  definition: DeepSeekToolDefinition;
  execute: (argumentsValue: unknown) => Promise<unknown>;
  /**
   * When present, the tool result is rendered inside our backend and is never
   * returned to DeepSeek. This is used for private operational data.
   */
  renderPrivateResult?: (
    value: unknown
  ) => string | { answer: string; actions: AssistantAction[] };
};

type DeepSeekRequestMessage =
  | { role: "system" | "user" | "tool"; content: string; tool_call_id?: string }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: DeepSeekToolCall[];
    };

type DeepSeekToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

const toolCallSchema = z.object({
  id: z.string().min(1),
  type: z.literal("function"),
  function: z.object({
    name: z.string().min(1),
    arguments: z.string(),
  }),
});

const completionSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          role: z.literal("assistant"),
          content: z.string().nullable().optional(),
          tool_calls: z.array(toolCallSchema).optional(),
        }),
      })
    )
    .min(1),
});

export class DeepSeekAssistantError extends Error {
  readonly kind: "timeout" | "upstream" | "invalid_response";

  constructor(
    kind: "timeout" | "upstream" | "invalid_response",
    message: string
  ) {
    super(message);
    this.kind = kind;
    this.name = "DeepSeekAssistantError";
  }
}

function parseToolArguments(raw: string): unknown {
  if (raw.length > 4_000) return null;
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return null;
  }
}

function safeToolOutput(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (!serialized) return "{}";
  return serialized.slice(0, MAX_TOOL_OUTPUT_CHARS);
}

async function requestCompletion(input: {
  apiKey: string;
  model: string;
  messages: DeepSeekRequestMessage[];
  tools: DeepSeekAssistantTool[];
  allowTools: boolean;
  forcedToolName?: string;
  fetchImpl: typeof fetch;
}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await input.fetchImpl(DEEPSEEK_CHAT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: input.model,
        messages: input.messages,
        stream: false,
        max_tokens: 1_200,
        thinking: { type: "disabled" },
        ...(input.tools.length
          ? {
              tools: input.tools.map(tool => tool.definition),
              tool_choice: (input.allowTools
                ? input.forcedToolName
                  ? {
                      type: "function",
                      function: { name: input.forcedToolName },
                    }
                  : "auto"
                : "none") satisfies DeepSeekToolChoice,
            }
          : {}),
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      console.error("DeepSeek request failed", {
        status: response.status,
        requestId: response.headers.get("x-request-id") ?? undefined,
      });
      throw new DeepSeekAssistantError(
        "upstream",
        "DeepSeek service returned an error"
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new DeepSeekAssistantError(
        "invalid_response",
        "DeepSeek response was not JSON"
      );
    }
    const parsed = completionSchema.safeParse(payload);
    if (!parsed.success) {
      throw new DeepSeekAssistantError(
        "invalid_response",
        "DeepSeek response had an unexpected shape"
      );
    }
    return parsed.data.choices[0].message;
  } catch (error) {
    if (error instanceof DeepSeekAssistantError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new DeepSeekAssistantError("timeout", "DeepSeek request timed out");
    }
    throw new DeepSeekAssistantError("upstream", "DeepSeek request failed");
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Server-only DeepSeek gateway. Tool calls are allowlisted by the caller and
 * their outputs are capped before they leave our backend.
 */
export async function runDeepSeekAssistant(input: {
  apiKey: string;
  model: string;
  systemPrompt: string;
  conversation: DeepSeekConversationMessage[];
  tools: DeepSeekAssistantTool[];
  forcedToolName?: string;
  fetchImpl?: typeof fetch;
}): Promise<DeepSeekAssistantResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const messages: DeepSeekRequestMessage[] = [
    { role: "system", content: input.systemPrompt },
    ...input.conversation,
  ];
  const toolsByName = new Map(
    input.tools.map(tool => [tool.definition.function.name, tool])
  );
  const forcedToolName =
    input.forcedToolName && toolsByName.has(input.forcedToolName)
      ? input.forcedToolName
      : undefined;

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
    const allowTools = round < MAX_TOOL_ROUNDS;
    const responseMessage = await requestCompletion({
      apiKey: input.apiKey,
      model: input.model,
      messages,
      tools: input.tools,
      allowTools,
      forcedToolName: round === 0 ? forcedToolName : undefined,
      fetchImpl,
    });
    const toolCalls = allowTools
      ? (responseMessage.tool_calls ?? []).slice(0, MAX_TOOL_CALLS_PER_ROUND)
      : [];

    if (!toolCalls.length) {
      if (round === 0 && forcedToolName) {
        throw new DeepSeekAssistantError(
          "invalid_response",
          "DeepSeek did not call the required tool"
        );
      }
      const answer = responseMessage.content?.trim();
      if (!answer) {
        throw new DeepSeekAssistantError(
          "invalid_response",
          "DeepSeek returned an empty answer"
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
      content: responseMessage.content ?? null,
      tool_calls: toolCalls,
    });
    const privateAnswers: string[] = [];
    const privateActions: AssistantAction[] = [];
    for (const toolCall of toolCalls) {
      const tool = toolsByName.get(toolCall.function.name);
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
        tool_call_id: toolCall.id,
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

  throw new DeepSeekAssistantError(
    "invalid_response",
    "DeepSeek did not return a final answer"
  );
}
