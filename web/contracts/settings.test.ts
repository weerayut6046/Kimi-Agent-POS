import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  mergeSettingDefaults,
  normalizeMeterOcrMode,
} from "./settings";

describe("meter OCR settings", () => {
  it("บังคับทุกค่าจากฐานข้อมูลรุ่นเก่าให้ประมวลผลในเครื่อง", () => {
    expect(normalizeMeterOcrMode("local")).toBe("local");
    expect(normalizeMeterOcrMode("gemini")).toBe("local");
    expect(normalizeMeterOcrMode("auto")).toBe("local");
    expect(normalizeMeterOcrMode(undefined)).toBe("local");
    expect(DEFAULT_SETTINGS.meter_ocr_mode).toBe("local");
    expect(
      mergeSettingDefaults([["meter_ocr_mode", "gemini"]]).meter_ocr_mode
    ).toBe("local");
  });
});
