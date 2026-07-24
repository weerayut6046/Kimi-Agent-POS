import { describe, expect, it, vi } from "vitest";
import { OllamaAssistantError, runOllamaAssistant } from "./ollama";
import type { DeepSeekAssistantTool } from "./deepseek";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Ollama server gateway", () => {
  it("calls the local chat API with Qwen and returns the answer", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        message: {
          role: "assistant",
          content: "พร้อมช่วยงาน PumpPOS ครับ",
        },
        done: true,
      })
    );

    const result = await runOllamaAssistant({
      baseUrl: "http://127.0.0.1:11434",
      model: "qwen3:4b",
      systemPrompt: "ตอบภาษาไทย",
      conversation: [{ role: "user", content: "สวัสดี" }],
      tools: [],
      fetchImpl,
    });

    expect(result).toEqual({
      answer: "พร้อมช่วยงาน PumpPOS ครับ",
      containsPrivateToolData: false,
      actions: [],
    });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:11434/api/chat");
    expect(new Headers(init?.headers).has("Authorization")).toBe(false);
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: "qwen3:4b",
      stream: false,
      think: false,
      keep_alive: "10m",
    });
  });

  it("does not expose model reasoning tags in the chat answer", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        message: {
          role: "assistant",
          content:
            "<think>internal reasoning that must stay hidden</think>\n\nคำตอบภาษาไทย",
        },
      })
    );

    const result = await runOllamaAssistant({
      baseUrl: "http://127.0.0.1:11434",
      model: "qwen3:4b",
      systemPrompt: "ตอบภาษาไทย",
      conversation: [{ role: "user", content: "ทดสอบ" }],
      tools: [],
      fetchImpl,
    });

    expect(result.answer).toBe("คำตอบภาษาไทย");
  });

  it("keeps only the final answer when a thinking model omits the opening tag", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        message: {
          role: "assistant",
          content:
            "Okay, let me inspect the rules and tools first.\n\nThis is internal reasoning.\n</think>\n\nสวัสดีครับ มีอะไรให้ช่วยไหมครับ",
        },
      }),
    );

    const result = await runOllamaAssistant({
      baseUrl: "http://127.0.0.1:11434",
      model: "qwen3:4b",
      systemPrompt: "ตอบภาษาไทย",
      conversation: [{ role: "user", content: "สวัสดีครับ" }],
      tools: [],
      fetchImpl,
    });

    expect(result.answer).toBe("สวัสดีครับ มีอะไรให้ช่วยไหมครับ");
    expect(result.answer).not.toContain("internal reasoning");
  });

  it("executes an allowlisted tool and returns its output to Ollama", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          message: {
            role: "assistant",
            content: "",
            tool_calls: [
              {
                type: "function",
                function: {
                  name: "get_low_stock",
                  arguments: {},
                },
              },
            ],
          },
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          message: {
            role: "assistant",
            content: "มีน้ำดื่มต่ำกว่าเกณฑ์",
          },
        })
      );
    const execute = vi.fn().mockResolvedValue({
      products: [{ name: "น้ำดื่ม", currentQuantity: 4 }],
    });
    const tools: DeepSeekAssistantTool[] = [
      {
        definition: {
          type: "function",
          function: {
            name: "get_low_stock",
            description: "read low stock",
            parameters: { type: "object", properties: {} },
          },
        },
        execute,
      },
    ];

    const result = await runOllamaAssistant({
      baseUrl: "http://localhost:11434/",
      model: "qwen3:4b",
      systemPrompt: "read only",
      conversation: [{ role: "user", content: "สต๊อกต่ำมีอะไรบ้าง" }],
      tools,
      fetchImpl,
    });

    expect(result.answer).toBe("มีน้ำดื่มต่ำกว่าเกณฑ์");
    expect(execute).toHaveBeenCalledWith({});
    const secondBody = JSON.parse(String(fetchImpl.mock.calls[1][1]?.body));
    expect(secondBody.messages.at(-1)).toEqual({
      role: "tool",
      tool_name: "get_low_stock",
      content: '{"products":[{"name":"น้ำดื่ม","currentQuantity":4}]}',
    });
  });

  it("renders sensitive tool data in the backend without a second model call", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({
        message: {
          role: "assistant",
          content: "",
          tool_calls: [
            {
              type: "function",
              function: {
                name: "get_today_sales_overview",
                arguments: {},
              },
            },
          ],
        },
      })
    );
    const execute = vi.fn().mockResolvedValue({ totalBaht: 9_999 });

    const result = await runOllamaAssistant({
      baseUrl: "http://127.0.0.1:11434",
      model: "qwen3:4b",
      systemPrompt: "read only",
      conversation: [{ role: "user", content: "ยอดขายวันนี้" }],
      tools: [
        {
          definition: {
            type: "function",
            function: {
              name: "get_today_sales_overview",
              description: "read aggregate sales",
              parameters: { type: "object", properties: {} },
            },
          },
          execute,
          renderPrivateResult: value => ({
            answer: `ยอดขาย ${(value as { totalBaht: number }).totalBaht} บาท`,
            actions: [
              { kind: "navigate", label: "เปิดรายงาน", path: "/reports" },
            ],
          }),
        },
      ],
      forcedToolName: "get_today_sales_overview",
      fetchImpl,
    });

    expect(result).toEqual({
      answer: "ยอดขาย 9999 บาท",
      containsPrivateToolData: true,
      actions: [{ kind: "navigate", label: "เปิดรายงาน", path: "/reports" }],
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const requestBody = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
    expect(requestBody.tools).toHaveLength(1);
    expect(JSON.stringify(requestBody)).not.toContain("9999");
  });

  it("reports a missing model separately from a connection failure", async () => {
    const missingModelFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse({ error: "model 'qwen3:4b' not found" }, 404)
      );
    const unavailableFetch = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError("fetch failed"));

    await expect(
      runOllamaAssistant({
        baseUrl: "http://127.0.0.1:11434",
        model: "qwen3:4b",
        systemPrompt: "read only",
        conversation: [{ role: "user", content: "สวัสดี" }],
        tools: [],
        fetchImpl: missingModelFetch,
      })
    ).rejects.toMatchObject({
      kind: "model_not_found",
    } satisfies Partial<OllamaAssistantError>);

    await expect(
      runOllamaAssistant({
        baseUrl: "http://127.0.0.1:11434",
        model: "qwen3:4b",
        systemPrompt: "read only",
        conversation: [{ role: "user", content: "สวัสดี" }],
        tools: [],
        fetchImpl: unavailableFetch,
      })
    ).rejects.toMatchObject({
      kind: "unavailable",
    } satisfies Partial<OllamaAssistantError>);
  });
});
