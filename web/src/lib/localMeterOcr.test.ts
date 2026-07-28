import { describe, expect, it } from "vitest";
import {
  findMainDisplays,
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

function meterImageData(input: {
  width?: number;
  height?: number;
  panelColor: [number, number, number];
  onePanelOnly?: boolean;
}) {
  const width = input.width ?? 400;
  const height = input.height ?? 300;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 4;
    data[offset] = 236;
    data[offset + 1] = 231;
    data[offset + 2] = 220;
    data[offset + 3] = 255;
  }
  const panels = input.onePanelOnly
    ? [{ x: 28, y: 48, width: 142, height: 62 }]
    : [
        { x: 28, y: 48, width: 142, height: 62 },
        { x: 230, y: 51, width: 144, height: 60 },
      ];
  for (const panel of panels) {
    for (let y = panel.y; y < panel.y + panel.height; y += 1) {
      for (let x = panel.x; x < panel.x + panel.width; x += 1) {
        const offset = (y * width + x) * 4;
        data[offset] = input.panelColor[0];
        data[offset + 1] = input.panelColor[1];
        data[offset + 2] = input.panelColor[2];
      }
    }
  }
  return { width, height, data } as ImageData;
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

  it("finds both LCD panels after mobile color conversion mutes the blue tint", () => {
    const displays = findMainDisplays(
      meterImageData({ panelColor: [148, 159, 165] })
    );

    expect(displays).not.toBeNull();
    expect(displays?.map(display => display.x)).toEqual([28, 230]);
  });

  it("finds both LCD panels in a darker mobile photo", () => {
    const displays = findMainDisplays(
      meterImageData({ panelColor: [64, 78, 90] })
    );

    expect(displays).not.toBeNull();
    expect(displays?.map(display => display.width)).toEqual([142, 144]);
  });

  it("does not invent the missing second LCD panel", () => {
    expect(
      findMainDisplays(
        meterImageData({
          panelColor: [148, 159, 165],
          onePanelOnly: true,
        })
      )
    ).toBeNull();
  });
});
