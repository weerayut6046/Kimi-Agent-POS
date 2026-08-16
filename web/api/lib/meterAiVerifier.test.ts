import { describe, expect, it, vi } from "vitest";
import { verifyMeterImagesWithGemini } from "./meterAiVerifier";

const image = {
  mimeType: "image/jpeg" as const,
  contentBase64: "/9j/4AAQ",
};

function successPayload() {
  return {
    output_text: JSON.stringify({
      images: [
        {
          imageIndex: 0,
          pumpNumber: 1,
          mode: "L",
          screens: [
            {
              side: "left",
              prefixDigits: "42",
              mainDigits: "0246.87",
              confidence: 0.96,
            },
          ],
          issue: "",
        },
      ],
    }),
  };
}

describe("Gemini meter verifier", () => {
  it("normalizes structured digits without letting AI calculate the value", async () => {
    let requestBody = "";
    let requestHeaders = new Headers();
    const fetchImpl: typeof fetch = async (_input, init) => {
      requestBody = String(init?.body ?? "");
      requestHeaders = new Headers(init?.headers);
      return Response.json(successPayload(), { status: 200 });
    };
    const result = await verifyMeterImagesWithGemini({
      apiKey: "test-key",
      apiUrl: "https://example.test/interactions",
      model: "gemini-test",
      images: [image],
      fetchImpl,
    });

    expect(result[0]?.screens[0]?.combinedText).toBe("420246.87");
    expect(result[0]?.screens[0]?.valid).toBe(true);
    const request = JSON.parse(requestBody);
    expect(request.store).toBe(false);
    expect(request.response_format.mime_type).toBe("application/json");
    expect(request.response_format.schema.properties.images.maxItems).toBe(2);
    expect(request.generation_config.thinking_level).toBe("low");
    expect(request.generation_config.max_output_tokens).toBe(1_024);
    expect(
      request.input.find((item: { type: string }) => item.type === "image")
        ?.resolution
    ).toBe("high");
    expect(requestHeaders.get("Api-Revision")).toBe("2026-05-20");
  });

  it("reads the current steps response shape", async () => {
    const payload = successPayload();
    const result = await verifyMeterImagesWithGemini({
      apiKey: "test-key",
      apiUrl: "https://example.test/interactions",
      model: "gemini-test",
      images: [image],
      fetchImpl: (async () =>
        Response.json({
          steps: [
            {
              type: "model_output",
              content: [{ type: "text", text: payload.output_text }],
            },
          ],
        })) as typeof fetch,
    });

    expect(result[0]?.screens[0]?.combinedText).toBe("420246.87");
  });

  it("keeps compatibility with direct text outputs", async () => {
    const payload = successPayload();
    const result = await verifyMeterImagesWithGemini({
      apiKey: "test-key",
      apiUrl: "https://example.test/interactions",
      model: "gemini-test",
      images: [image],
      fetchImpl: (async () =>
        Response.json({
          outputs: [{ type: "text", text: payload.output_text }],
        })) as typeof fetch,
    });

    expect(result[0]?.screens[0]?.combinedText).toBe("420246.87");
  });

  it("rejects mixed characters returned as meter digits", async () => {
    const payload = successPayload();
    const decoded = JSON.parse(payload.output_text);
    decoded.images[0].screens[0].mainDigits = "02B6.87";
    payload.output_text = JSON.stringify(decoded);

    const result = await verifyMeterImagesWithGemini({
      apiKey: "test-key",
      apiUrl: "https://example.test/interactions",
      model: "gemini-test",
      images: [image],
      fetchImpl: (async () => Response.json(payload)) as typeof fetch,
    });

    expect(result[0]?.screens[0]?.valid).toBe(false);
    expect(result[0]?.screens[0]?.combinedText).toBeNull();
  });

  it("does not call the network without an API key", async () => {
    const fetchImpl = vi.fn();
    await expect(
      verifyMeterImagesWithGemini({
        apiKey: "",
        apiUrl: "https://example.test/interactions",
        model: "gemini-test",
        images: [image],
        fetchImpl: fetchImpl as typeof fetch,
      })
    ).rejects.toMatchObject({ kind: "not_configured" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("classifies API quota errors", async () => {
    await expect(
      verifyMeterImagesWithGemini({
        apiKey: "test-key",
        apiUrl: "https://example.test/interactions",
        model: "gemini-test",
        images: [image],
        fetchImpl: (async () =>
          new Response("quota", { status: 429 })) as typeof fetch,
      })
    ).rejects.toMatchObject({ kind: "rate_limited" });
  });
});
