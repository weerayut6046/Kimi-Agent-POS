import { describe, expect, it, vi } from "vitest";
import { runDeepSeekAssistant, type DeepSeekAssistantTool } from "./deepseek";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("DeepSeek server gateway", () => {
  it("keeps the API key in the Authorization header and returns plain answer text", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        choices: [
          {
            message: {
              role: "assistant",
              content: "ยอดขายวันนี้ 1,250 บาท",
            },
          },
        ],
      })
    );

    const result = await runDeepSeekAssistant({
      apiKey: "server-only-key",
      model: "deepseek-v4-flash",
      systemPrompt: "ตอบภาษาไทย",
      conversation: [{ role: "user", content: "ยอดขายวันนี้เท่าไร" }],
      tools: [],
      fetchImpl,
    });

    expect(result).toEqual({
      answer: "ยอดขายวันนี้ 1,250 บาท",
      containsPrivateToolData: false,
      actions: [],
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.deepseek.com/chat/completions");
    expect(new Headers(init?.headers).get("Authorization")).toBe(
      "Bearer server-only-key"
    );
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({
      model: "deepseek-v4-flash",
      stream: false,
      thinking: { type: "disabled" },
    });
    expect(String(init?.body)).not.toContain("server-only-key");
  });

  it("executes only an allowlisted tool and sends its bounded result back for a final answer", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          choices: [
            {
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "call-stock",
                    type: "function",
                    function: { name: "get_low_stock", arguments: "{}" },
                  },
                ],
              },
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          choices: [
            {
              message: {
                role: "assistant",
                content: "มีน้ำดื่มต่ำกว่าเกณฑ์",
              },
            },
          ],
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

    const result = await runDeepSeekAssistant({
      apiKey: "key",
      model: "deepseek-v4-flash",
      systemPrompt: "read only",
      conversation: [{ role: "user", content: "สต๊อกต่ำมีอะไรบ้าง" }],
      tools,
      fetchImpl,
    });

    expect(result).toEqual({
      answer: "มีน้ำดื่มต่ำกว่าเกณฑ์",
      containsPrivateToolData: false,
      actions: [],
    });
    expect(execute).toHaveBeenCalledWith({});
    const secondBody = JSON.parse(String(fetchImpl.mock.calls[1][1]?.body));
    expect(secondBody.messages.at(-1)).toEqual({
      role: "tool",
      tool_call_id: "call-stock",
      content: '{"products":[{"name":"น้ำดื่ม","currentQuantity":4}]}',
    });
  });

  it("renders private tool data locally without sending the result back to DeepSeek", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({
        choices: [
          {
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call-sales",
                  type: "function",
                  function: {
                    name: "get_today_sales_overview",
                    arguments: "{}",
                  },
                },
              ],
            },
          },
        ],
      })
    );
    const execute = vi.fn().mockResolvedValue({ totalBaht: 9_999 });

    const result = await runDeepSeekAssistant({
      apiKey: "key",
      model: "deepseek-v4-flash",
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
    expect(requestBody.tool_choice).toEqual({
      type: "function",
      function: { name: "get_today_sales_overview" },
    });
    expect(JSON.stringify(requestBody)).not.toContain("9999");
  });

  it("does not execute a tool name that was not allowlisted", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          choices: [
            {
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "call-secret",
                    type: "function",
                    function: {
                      name: "read_customer_records",
                      arguments: "{}",
                    },
                  },
                ],
              },
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          choices: [
            {
              message: {
                role: "assistant",
                content: "ฉันไม่มีสิทธิ์อ่านข้อมูลนั้น",
              },
            },
          ],
        })
      );

    await runDeepSeekAssistant({
      apiKey: "key",
      model: "deepseek-v4-flash",
      systemPrompt: "read only",
      conversation: [{ role: "user", content: "อ่านข้อมูลลูกค้า" }],
      tools: [],
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const secondBody = JSON.parse(String(fetchImpl.mock.calls[1][1]?.body));
    expect(secondBody.messages.at(-1)).toEqual({
      role: "tool",
      tool_call_id: "call-secret",
      content: '{"error":"tool_not_available"}',
    });
  });
});
