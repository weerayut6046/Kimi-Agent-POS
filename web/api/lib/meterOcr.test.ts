import { describe, expect, it, vi } from "vitest";
import { MeterOcrError, readMeterImages } from "./meterOcr";

const images = [
  {
    contentBase64: "YQ==",
    mimeType: "image/jpeg" as const,
  },
];

function responsePayload(value: unknown) {
  return {
    output_text: JSON.stringify(value),
  };
}

describe("readMeterImages", () => {
  it("อ่าน structured output จาก steps ของ Interactions REST API", async () => {
    const structuredResult = {
      images: [
        {
          imageIndex: 0,
          pumpNumber: 1,
          mode: "L",
          screens: [
            {
              side: "left",
              prefixDigits: "39",
              mainDigits: "6962.39",
              confidence: 0.99,
            },
          ],
          issue: "",
        },
      ],
    };
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "completed",
          steps: [
            {
              type: "model_output",
              content: [
                {
                  type: "text",
                  text: JSON.stringify(structuredResult),
                },
              ],
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const result = await readMeterImages({
      apiKey: "test-key",
      apiUrl: "https://generativelanguage.googleapis.com/v1beta/interactions",
      model: "gemini-3.5-flash-lite",
      images,
      fetchImpl,
    });

    expect(result[0]?.screens[0]).toMatchObject({
      combinedText: "396962.39",
      value: 396_962.39,
      valid: true,
    });
  });

  it("ต่อเลขหลักบนกับเลขหลักล่างโดยรักษาศูนย์นำหน้า", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify(
          responsePayload({
            images: [
              {
                imageIndex: 0,
                pumpNumber: 2,
                mode: "L",
                screens: [
                  {
                    side: "left",
                    prefixDigits: "42",
                    mainDigits: "0105.81",
                    confidence: 0.99,
                  },
                  {
                    side: "right",
                    prefixDigits: "29",
                    mainDigits: "5885.00",
                    confidence: 0.98,
                  },
                ],
                issue: "",
              },
            ],
          })
        ),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const result = await readMeterImages({
      apiKey: "test-key",
      apiUrl: "https://generativelanguage.googleapis.com/v1beta/interactions",
      model: "gemini-3.5-flash-lite",
      images,
      fetchImpl,
    });

    expect(result[0]).toMatchObject({
      pumpNumber: 2,
      mode: "L",
      screens: [
        {
          side: "left",
          combinedText: "420105.81",
          value: 420_105.81,
          valid: true,
        },
        {
          side: "right",
          combinedText: "295885.00",
          value: 295_885,
          valid: true,
        },
      ],
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const request = JSON.parse(
      String((fetchImpl.mock.calls[0]?.[1] as RequestInit).body)
    );
    expect(request.input[2]).toMatchObject({
      type: "image",
      data: "YQ==",
      mime_type: "image/jpeg",
    });
    expect(request.response_format).toMatchObject({
      type: "text",
      mime_type: "application/json",
    });
    expect(request.generation_config.thinking_level).toBe("minimal");
    expect(request.model).toBe("gemini-3.5-flash-lite");

    const headers = (fetchImpl.mock.calls[0]?.[1] as RequestInit)
      .headers as Record<string, string>;
    expect(headers["x-goog-api-key"]).toBe("test-key");
    expect(headers.Authorization).toBeUndefined();
  });

  it("ปฏิเสธผลลัพธ์ตัวเลขที่มีตัวอักษรปน", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify(
          responsePayload({
            images: [
              {
                imageIndex: 0,
                pumpNumber: 1,
                mode: "P",
                screens: [
                  {
                    side: "left",
                    prefixDigits: "84",
                    mainDigits: "74O23.1",
                    confidence: 0.4,
                  },
                ],
                issue: "ตัวเลขไม่ชัด",
              },
            ],
          })
        ),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const result = await readMeterImages({
      apiKey: "test-key",
      apiUrl: "https://generativelanguage.googleapis.com/v1beta/interactions",
      model: "gemini-3.5-flash-lite",
      images,
      fetchImpl,
    });

    expect(result[0]?.screens[0]).toMatchObject({
      combinedText: null,
      value: null,
      valid: false,
    });
  });

  it("แจ้งว่าไม่ได้ตั้งค่า API key โดยไม่เรียกเครือข่าย", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(
      readMeterImages({
        apiKey: "",
        apiUrl: "https://generativelanguage.googleapis.com/v1beta/interactions",
        model: "gemini-3.5-flash-lite",
        images,
        fetchImpl,
      })
    ).rejects.toMatchObject({
      kind: "not_configured",
    } satisfies Partial<MeterOcrError>);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("แยกข้อผิดพลาดโควตา Gemini จากข้อผิดพลาด upstream ทั่วไป", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("quota exceeded", { status: 429 }));

    await expect(
      readMeterImages({
        apiKey: "test-key",
        apiUrl: "https://generativelanguage.googleapis.com/v1beta/interactions",
        model: "gemini-3.5-flash-lite",
        images,
        fetchImpl,
      })
    ).rejects.toMatchObject({
      kind: "rate_limited",
    } satisfies Partial<MeterOcrError>);
  });
});
