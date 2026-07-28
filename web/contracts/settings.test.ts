import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, normalizeMeterOcrMode } from "./settings";

describe("meter OCR settings", () => {
  it("accepts every supported admin mode", () => {
    expect(normalizeMeterOcrMode("local")).toBe("local");
    expect(normalizeMeterOcrMode("gemini")).toBe("gemini");
    expect(normalizeMeterOcrMode("auto")).toBe("auto");
  });

  it("keeps Gemini as the backwards-compatible default", () => {
    expect(DEFAULT_SETTINGS.meter_ocr_mode).toBe("gemini");
    expect(normalizeMeterOcrMode(undefined)).toBe("gemini");
    expect(normalizeMeterOcrMode("disabled")).toBe("gemini");
  });
});
