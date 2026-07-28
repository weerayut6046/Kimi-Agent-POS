import { describe, expect, it } from "vitest";
import {
  matchSevenSegmentDigit,
  shouldUseGeminiFallback,
  type MeterImageScanResult,
} from "./localMeterOcr";

const patterns = {
  "0": ["a", "b", "c", "d", "e", "f"],
  "1": ["b", "c"],
  "2": ["a", "b", "d", "e", "g"],
  "3": ["a", "b", "c", "d", "g"],
  "4": ["b", "c", "f", "g"],
  "5": ["a", "c", "d", "f", "g"],
  "6": ["a", "c", "d", "e", "f", "g"],
  "7": ["a", "b", "c"],
  "8": ["a", "b", "c", "d", "e", "f", "g"],
  "9": ["a", "b", "c", "d", "f", "g"],
} as const;

function validResult(): MeterImageScanResult {
  return {
    imageIndex: 0,
    pumpNumber: 1,
    mode: "L",
    issue: "",
    screens: [
      {
        side: "left",
        prefixDigits: "39",
        mainDigits: "6962.39",
        combinedText: "396962.39",
        value: 396962.39,
        confidence: 0.94,
        valid: true,
      },
      {
        side: "right",
        prefixDigits: "90",
        mainDigits: "3971.37",
        combinedText: "903971.37",
        value: 903971.37,
        confidence: 0.92,
        valid: true,
      },
    ],
  };
}

describe("local seven-segment OCR", () => {
  it("maps every standard seven-segment pattern to its digit", () => {
    for (const [digit, segments] of Object.entries(patterns)) {
      expect(matchSevenSegmentDigit(segments)).toEqual({
        digit,
        distance: 0,
      });
    }
  });

  it("uses Gemini fallback only when the local result needs review", () => {
    expect(shouldUseGeminiFallback(validResult())).toBe(false);
    expect(
      shouldUseGeminiFallback({
        ...validResult(),
        screens: validResult().screens.map((screen, index) =>
          index === 0 ? { ...screen, confidence: 0.7 } : screen
        ),
      })
    ).toBe(true);
    expect(
      shouldUseGeminiFallback({ ...validResult(), pumpNumber: null })
    ).toBe(true);
    expect(shouldUseGeminiFallback({ ...validResult(), mode: "unknown" })).toBe(
      true
    );
  });
});
