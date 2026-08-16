import { describe, expect, it } from "vitest";
import {
  findMainDisplays,
  matchSevenSegmentDigit,
  measureSpecularGlare,
  readMeterScreenImageData,
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

function sevenSegmentScreenData(redChannelAmbiguous = false) {
  const width = 400;
  const height = 200;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const red = redChannelAmbiguous
        ? 92
        : Math.round(122 - (x / width) * 48 + (y / height) * 5);
      const offset = (y * width + x) * 4;
      data[offset] = red;
      data[offset + 1] = redChannelAmbiguous ? 142 : red + 18;
      data[offset + 2] = redChannelAmbiguous ? 162 : red + 36;
      data[offset + 3] = 255;
    }
  }
  const paint = (x: number, y: number, boxWidth: number, boxHeight: number) => {
    for (let row = y; row < y + boxHeight; row += 1) {
      for (let column = x; column < x + boxWidth; column += 1) {
        const offset = (row * width + column) * 4;
        data[offset] = redChannelAmbiguous ? 92 : 18;
        data[offset + 1] = redChannelAmbiguous ? 22 : 27;
        data[offset + 2] = redChannelAmbiguous ? 24 : 38;
      }
    }
  };
  const drawCharacter = (
    character: keyof typeof patterns | "L",
    x: number,
    y: number,
    digitWidth: number,
    digitHeight: number
  ) => {
    const thickness = Math.max(4, Math.round(digitWidth * 0.18));
    const segments =
      character === "L" ? (["d", "e", "f"] as const) : patterns[character];
    const verticalHeight = Math.floor(digitHeight / 2) - thickness;
    const rectangles = {
      a: [x + thickness, y, digitWidth - thickness * 2, thickness],
      b: [x + digitWidth - thickness, y + thickness, thickness, verticalHeight],
      c: [
        x + digitWidth - thickness,
        y + Math.floor(digitHeight / 2),
        thickness,
        verticalHeight,
      ],
      d: [
        x + thickness,
        y + digitHeight - thickness,
        digitWidth - thickness * 2,
        thickness,
      ],
      e: [x, y + Math.floor(digitHeight / 2), thickness, verticalHeight],
      f: [x, y + thickness, thickness, verticalHeight],
      g: [
        x + thickness,
        y + Math.floor(digitHeight / 2) - Math.floor(thickness / 2),
        digitWidth - thickness * 2,
        thickness,
      ],
    } satisfies Record<string, [number, number, number, number]>;
    for (const segment of segments) {
      paint(...rectangles[segment]);
    }
  };

  drawCharacter("L", 25, 20, 34, 62);
  drawCharacter("4", 260, 20, 36, 62);
  drawCharacter("2", 330, 20, 36, 62);
  for (const [index, digit] of [..."024687"].entries()) {
    drawCharacter(digit as keyof typeof patterns, 18 + index * 60, 101, 40, 82);
  }
  paint(246, 175, 7, 7);

  return { width, height, data } as ImageData;
}

function addReflection(
  imageData: ImageData,
  left: number,
  right: number
) {
  for (let y = 0; y < imageData.height; y += 1) {
    for (let x = left; x < right; x += 1) {
      const offset = (y * imageData.width + x) * 4;
      imageData.data[offset] = 246;
      imageData.data[offset + 1] = 244;
      imageData.data[offset + 2] = 240;
    }
  }
  return imageData;
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

  it("finds neutral-gray LCD panels after aggressive camera white balance", () => {
    const displays = findMainDisplays(
      meterImageData({ panelColor: [136, 139, 141] })
    );

    expect(displays?.map(display => display.x)).toEqual([28, 230]);
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

  it("reads seven-segment values across an uneven mobile-photo background", () => {
    const result = readMeterScreenImageData(sevenSegmentScreenData(), "left");

    expect(result.mode.mode).toBe("L");
    expect(result.screen.prefixDigits).toBe("42");
    expect(result.screen.mainDigits).toBe("0246.87");
    expect(result.screen.combinedText).toBe("420246.87");
    expect(result.screen.valid).toBe(true);
  });

  it("uses luminance consensus when the red channel has no segment contrast", () => {
    const result = readMeterScreenImageData(
      sevenSegmentScreenData(true),
      "right"
    );

    expect(result.mode.mode).toBe("L");
    expect(result.screen.combinedText).toBe("420246.87");
    expect(result.screen.valid).toBe(true);
  });

  it("measures a clipped reflection across an LCD instead of treating it as trustworthy", () => {
    const screen = addReflection(sevenSegmentScreenData(), 120, 180);

    expect(measureSpecularGlare(screen)).toBeGreaterThan(0.14);
    expect(readMeterScreenImageData(screen, "left").screen.glareRatio).toBe(
      measureSpecularGlare(screen)
    );
  });
});
