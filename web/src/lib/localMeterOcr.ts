import {
  combineMeterDisplayDigits,
  type MeterDisplayMode,
  type MeterDisplaySide,
} from "@contracts/meterOcr";
import type { PreparedMeterImage } from "@/lib/shiftMeterScan";

export type MeterImageScanScreen = {
  side: MeterDisplaySide;
  prefixDigits: string;
  mainDigits: string;
  combinedText: string | null;
  value: number | null;
  confidence: number;
  valid: boolean;
};

export type MeterImageScanResult = {
  imageIndex: number;
  pumpNumber: number | null;
  mode: MeterDisplayMode;
  screens: MeterImageScanScreen[];
  issue: string;
};

type Bounds = {
  x: number;
  y: number;
  width: number;
  height: number;
  area: number;
  pixels?: number[];
};

type DigitRead = {
  text: string;
  confidence: number;
};

type ModeRead = {
  mode: MeterDisplayMode;
  confidence: number;
};

type Segment = "a" | "b" | "c" | "d" | "e" | "f" | "g";

const SEGMENT_PATTERNS: Readonly<Record<string, readonly Segment[]>> = {
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
};

const MODE_PATTERNS: Readonly<
  Record<Exclude<MeterDisplayMode, "unknown">, readonly Segment[]>
> = {
  L: ["d", "e", "f"],
  P: ["a", "b", "e", "f", "g"],
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function hammingDistance(
  actual: ReadonlySet<Segment>,
  expected: readonly Segment[]
) {
  const expectedSet = new Set(expected);
  let distance = 0;
  for (const segment of ["a", "b", "c", "d", "e", "f", "g"] as const) {
    if (actual.has(segment) !== expectedSet.has(segment)) distance += 1;
  }
  return distance;
}

export function matchSevenSegmentDigit(activeSegments: readonly Segment[]): {
  digit: string;
  distance: number;
} {
  const active = new Set(activeSegments);
  let best = { digit: "", distance: Number.POSITIVE_INFINITY };
  for (const [digit, pattern] of Object.entries(SEGMENT_PATTERNS)) {
    const distance = hammingDistance(active, pattern);
    if (distance < best.distance) best = { digit, distance };
  }
  return best;
}

function connectedComponents(
  mask: Uint8Array,
  width: number,
  height: number,
  includePixels = false,
  eightConnected = false
): Bounds[] {
  const visited = new Uint8Array(mask.length);
  const queue = new Int32Array(mask.length);
  const components: Bounds[] = [];
  const neighbors = eightConnected
    ? [
        [-1, -1],
        [0, -1],
        [1, -1],
        [-1, 0],
        [1, 0],
        [-1, 1],
        [0, 1],
        [1, 1],
      ]
    : [
        [0, -1],
        [-1, 0],
        [1, 0],
        [0, 1],
      ];

  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || visited[start]) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    visited[start] = 1;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    let area = 0;
    const pixels: number[] | undefined = includePixels ? [] : undefined;

    while (head < tail) {
      const index = queue[head++]!;
      const x = index % width;
      const y = Math.floor(index / width);
      area += 1;
      pixels?.push(index);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);

      for (const [offsetX, offsetY] of neighbors) {
        const nextX = x + offsetX;
        const nextY = y + offsetY;
        if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) {
          continue;
        }
        const next = nextY * width + nextX;
        if (!mask[next] || visited[next]) continue;
        visited[next] = 1;
        queue[tail++] = next;
      }
    }

    components.push({
      x: minX,
      y: minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
      area,
      pixels,
    });
  }
  return components;
}

function imageDataMask(
  imageData: ImageData,
  predicate: (red: number, green: number, blue: number) => boolean
) {
  const mask = new Uint8Array(imageData.width * imageData.height);
  for (let index = 0; index < mask.length; index += 1) {
    const offset = index * 4;
    if (
      predicate(
        imageData.data[offset]!,
        imageData.data[offset + 1]!,
        imageData.data[offset + 2]!
      )
    ) {
      mask[index] = 1;
    }
  }
  return mask;
}

function findMainDisplays(imageData: ImageData): [Bounds, Bounds] | null {
  const { width, height } = imageData;
  const blueMask = imageDataMask(
    imageData,
    (red, green, blue) =>
      blue - red > 25 &&
      blue - green > 8 &&
      red > 90 &&
      green > 110 &&
      blue > 145
  );
  const candidates = connectedComponents(blueMask, width, height)
    .filter(component => {
      const fill = component.area / (component.width * component.height);
      return (
        component.width >= width * 0.18 &&
        component.width <= width * 0.38 &&
        component.height >= height * 0.12 &&
        component.height <= height * 0.28 &&
        fill >= 0.45
      );
    })
    .sort((left, right) => right.area - left.area)
    .slice(0, 2)
    .sort((left, right) => left.x - right.x);
  return candidates.length === 2 ? [candidates[0]!, candidates[1]!] : null;
}

function otsuThreshold(imageData: ImageData) {
  const histogram = new Uint32Array(256);
  const pixels = imageData.width * imageData.height;
  for (let index = 0; index < pixels; index += 1) {
    histogram[imageData.data[index * 4]!] += 1;
  }

  let totalIntensity = 0;
  for (let value = 0; value < 256; value += 1) {
    totalIntensity += value * histogram[value]!;
  }

  let backgroundWeight = 0;
  let backgroundIntensity = 0;
  let bestVariance = -1;
  let threshold = 90;
  for (let value = 0; value < 256; value += 1) {
    backgroundWeight += histogram[value]!;
    if (backgroundWeight === 0) continue;
    const foregroundWeight = pixels - backgroundWeight;
    if (foregroundWeight === 0) break;
    backgroundIntensity += value * histogram[value]!;
    const backgroundMean = backgroundIntensity / backgroundWeight;
    const foregroundMean =
      (totalIntensity - backgroundIntensity) / foregroundWeight;
    const variance =
      backgroundWeight *
      foregroundWeight *
      (backgroundMean - foregroundMean) ** 2;
    if (variance > bestVariance) {
      bestVariance = variance;
      threshold = value;
    }
  }
  return clamp(threshold + 15, 80, 115);
}

function roiMask(
  imageData: ImageData,
  threshold: number,
  left: number,
  top: number,
  right: number,
  bottom: number
): { mask: Uint8Array; width: number; height: number } {
  const x0 = clamp(Math.floor(imageData.width * left), 0, imageData.width - 1);
  const y0 = clamp(Math.floor(imageData.height * top), 0, imageData.height - 1);
  const x1 = clamp(Math.ceil(imageData.width * right), x0 + 1, imageData.width);
  const y1 = clamp(
    Math.ceil(imageData.height * bottom),
    y0 + 1,
    imageData.height
  );
  const width = x1 - x0;
  const height = y1 - y0;
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sourceOffset = ((y + y0) * imageData.width + x + x0) * 4;
      if (imageData.data[sourceOffset]! < threshold) {
        mask[y * width + x] = 1;
      }
    }
  }
  return { mask, width, height };
}

function cropRowsToLongestRun(input: {
  mask: Uint8Array;
  width: number;
  height: number;
}) {
  const active: boolean[] = [];
  for (let y = 0; y < input.height; y += 1) {
    let count = 0;
    for (let x = 0; x < input.width; x += 1) {
      count += input.mask[y * input.width + x]!;
    }
    active.push(count > input.width * 0.015);
  }

  let bestStart = 0;
  let bestEnd = 0;
  let runStart = -1;
  for (let index = 0; index <= active.length; index += 1) {
    if (active[index]) {
      if (runStart < 0) runStart = index;
      continue;
    }
    if (runStart >= 0 && index - runStart > bestEnd - bestStart) {
      bestStart = runStart;
      bestEnd = index;
    }
    runStart = -1;
  }
  if (bestEnd - bestStart < input.height * 0.45) return input;

  const height = bestEnd - bestStart;
  const mask = new Uint8Array(input.width * height);
  for (let y = 0; y < height; y += 1) {
    mask.set(
      input.mask.subarray(
        (bestStart + y) * input.width,
        (bestStart + y + 1) * input.width
      ),
      y * input.width
    );
  }
  return { mask, width: input.width, height };
}

function segmentDensity(
  mask: Uint8Array,
  width: number,
  height: number,
  left: number,
  top: number,
  right: number,
  bottom: number
) {
  const x0 = clamp(Math.floor(width * left), 0, width - 1);
  const y0 = clamp(Math.floor(height * top), 0, height - 1);
  const x1 = clamp(Math.ceil(width * right), x0 + 1, width);
  const y1 = clamp(Math.ceil(height * bottom), y0 + 1, height);
  let active = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      active += mask[y * width + x]!;
    }
  }
  return active / ((x1 - x0) * (y1 - y0));
}

function activeSegments(
  mask: Uint8Array,
  width: number,
  height: number
): Segment[] {
  const density: Record<Segment, number> = {
    a: segmentDensity(mask, width, height, 0.15, 0, 0.85, 0.2),
    g: segmentDensity(mask, width, height, 0.15, 0.4, 0.85, 0.6),
    d: segmentDensity(mask, width, height, 0.15, 0.8, 0.85, 1),
    f: segmentDensity(mask, width, height, 0, 0.08, 0.3, 0.48),
    b: segmentDensity(mask, width, height, 0.7, 0.08, 1, 0.48),
    e: segmentDensity(mask, width, height, 0, 0.52, 0.3, 0.92),
    c: segmentDensity(mask, width, height, 0.7, 0.52, 1, 0.92),
  };
  const maximumHorizontal = Math.max(density.a, density.g, density.d);
  const maximumVertical = Math.max(density.b, density.c, density.e, density.f);
  const horizontalThreshold = Math.max(0.18, maximumHorizontal * 0.55);
  const verticalThreshold = Math.max(0.18, maximumVertical * 0.45);
  return (Object.keys(density) as Segment[]).filter(segment =>
    ["a", "g", "d"].includes(segment)
      ? density[segment] >= horizontalThreshold
      : density[segment] >= verticalThreshold
  );
}

function maskBounds(
  mask: Uint8Array,
  sourceWidth: number,
  bounds: Bounds
): { mask: Uint8Array; width: number; height: number } {
  const output = new Uint8Array(bounds.width * bounds.height);
  for (let y = 0; y < bounds.height; y += 1) {
    for (let x = 0; x < bounds.width; x += 1) {
      output[y * bounds.width + x] =
        mask[(bounds.y + y) * sourceWidth + bounds.x + x]!;
    }
  }
  return { mask: output, width: bounds.width, height: bounds.height };
}

function columnRuns(
  mask: Uint8Array,
  width: number,
  height: number
): Array<{ start: number; end: number }> {
  const active: boolean[] = [];
  for (let x = 0; x < width; x += 1) {
    let count = 0;
    for (let y = 0; y < height; y += 1) {
      count += mask[y * width + x]!;
    }
    active.push(count > height * 0.04);
  }

  const runs: Array<{ start: number; end: number }> = [];
  let start = -1;
  for (let index = 0; index <= active.length; index += 1) {
    if (active[index]) {
      if (start < 0) start = index;
      continue;
    }
    if (start >= 0 && index - start >= 2) {
      runs.push({ start, end: index });
    }
    start = -1;
  }
  return runs;
}

function runBounds(
  mask: Uint8Array,
  width: number,
  height: number,
  start: number,
  end: number
): Bounds | null {
  let minX = end;
  let minY = height;
  let maxX = start;
  let maxY = 0;
  let area = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = start; x < end; x += 1) {
      if (!mask[y * width + x]) continue;
      area += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (!area) return null;
  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
    area,
  };
}

function decodeDigits(
  input: { mask: Uint8Array; width: number; height: number },
  includeDecimal: boolean
): DigitRead {
  const mask = input.mask.slice();
  let decimalX: number | null = null;
  const components = connectedComponents(
    mask,
    input.width,
    input.height,
    true,
    true
  );
  for (const component of components) {
    const isDecimal =
      includeDecimal &&
      component.y > input.height * 0.7 &&
      component.width < input.height * 0.27 &&
      component.height < input.height * 0.27 &&
      component.area > input.height * input.height * 0.006;
    const isNoise =
      component.area < input.height * input.height * 0.012 && !isDecimal;
    if (isDecimal) decimalX = component.x + component.width / 2;
    if (isDecimal || isNoise) {
      for (const index of component.pixels ?? []) mask[index] = 0;
    }
  }

  const decoded: Array<{
    x: number;
    character: string;
    confidence: number;
  }> = [];
  for (const run of columnRuns(mask, input.width, input.height)) {
    const bounds = runBounds(
      mask,
      input.width,
      input.height,
      run.start,
      run.end
    );
    if (
      !bounds ||
      bounds.area < input.height * input.height * 0.008 ||
      bounds.height < input.height * 0.55 ||
      bounds.width < input.height * 0.09
    ) {
      continue;
    }

    if (bounds.width / bounds.height < 0.34) {
      decoded.push({
        x: bounds.x + bounds.width / 2,
        character: "1",
        confidence: 0.94,
      });
      continue;
    }

    const digitMask = maskBounds(mask, input.width, bounds);
    const match = matchSevenSegmentDigit(
      activeSegments(digitMask.mask, digitMask.width, digitMask.height)
    );
    decoded.push({
      x: bounds.x + bounds.width / 2,
      character: match.digit,
      confidence: clamp(0.96 - match.distance * 0.18, 0.35, 0.96),
    });
  }

  if (decimalX != null) {
    decoded.push({ x: decimalX, character: ".", confidence: 0.96 });
  }
  decoded.sort((left, right) => left.x - right.x);
  return {
    text: decoded.map(item => item.character).join(""),
    confidence: decoded.length
      ? Math.min(...decoded.map(item => item.confidence))
      : 0,
  };
}

function decodeMode(input: {
  mask: Uint8Array;
  width: number;
  height: number;
}): ModeRead {
  const bounds = columnRuns(input.mask, input.width, input.height)
    .map(run =>
      runBounds(input.mask, input.width, input.height, run.start, run.end)
    )
    .filter(
      (candidate): candidate is Bounds =>
        candidate != null &&
        candidate.area >= input.height * input.height * 0.01 &&
        candidate.height >= input.height * 0.55
    )
    .sort((left, right) => right.area - left.area)[0];
  if (!bounds) return { mode: "unknown", confidence: 0 };
  const modeMask = maskBounds(input.mask, input.width, bounds);
  const active = new Set(
    activeSegments(modeMask.mask, modeMask.width, modeMask.height)
  );
  const candidates = (["L", "P"] as const)
    .map(mode => ({
      mode,
      distance: hammingDistance(active, MODE_PATTERNS[mode]),
    }))
    .sort((left, right) => left.distance - right.distance);
  const best = candidates[0]!;
  return {
    mode: best.distance <= 3 ? best.mode : "unknown",
    confidence: clamp(0.94 - best.distance * 0.18, 0.25, 0.94),
  };
}

function readScreen(
  imageData: ImageData,
  side: MeterDisplaySide
): { screen: MeterImageScanScreen; mode: ModeRead } {
  const threshold = otsuThreshold(imageData);
  const main = cropRowsToLongestRun(
    roiMask(imageData, threshold, 0.02, 0.42, 0.98, 0.98)
  );
  const prefix = roiMask(imageData, threshold, 0.5, 0.06, 1, 0.46);
  const modeMask = roiMask(imageData, threshold, 0.03, 0.06, 0.3, 0.5);
  const mainRead = decodeDigits(main, true);
  const prefixRead = decodeDigits(prefix, false);
  const mode = decodeMode(modeMask);
  const combined = combineMeterDisplayDigits(prefixRead.text, mainRead.text);

  return {
    screen: {
      side,
      prefixDigits: prefixRead.text,
      mainDigits: mainRead.text,
      combinedText: combined?.combinedText ?? null,
      value: combined?.value ?? null,
      confidence: Math.min(
        mainRead.confidence,
        prefixRead.confidence,
        mode.confidence
      ),
      valid: combined != null,
    },
    mode,
  };
}

function extractScreenImageData(
  image: HTMLImageElement,
  analysisWidth: number,
  analysisHeight: number,
  bounds: Bounds
) {
  const scaleX = image.naturalWidth / analysisWidth;
  const scaleY = image.naturalHeight / analysisHeight;
  const sourceX = Math.max(0, Math.floor(bounds.x * scaleX));
  const sourceY = Math.max(0, Math.floor(bounds.y * scaleY));
  const sourceWidth = Math.min(
    image.naturalWidth - sourceX,
    Math.ceil(bounds.width * scaleX)
  );
  const sourceHeight = Math.min(
    image.naturalHeight - sourceY,
    Math.ceil(bounds.height * scaleY)
  );
  const targetWidth = Math.min(720, sourceWidth);
  const targetHeight = Math.max(
    1,
    Math.round(sourceHeight * (targetWidth / sourceWidth))
  );
  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const context = canvas.getContext("2d", {
    alpha: false,
    willReadFrequently: true,
  });
  if (!context) throw new Error("อุปกรณ์นี้ไม่รองรับการอ่านภาพในเครื่อง");
  context.drawImage(
    image,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    targetWidth,
    targetHeight
  );
  return context.getImageData(0, 0, targetWidth, targetHeight);
}

function detectPumpNumber(
  imageData: ImageData,
  left: Bounds,
  right: Bounds
): number | null {
  const marginX = Math.max(3, Math.round(imageData.width * 0.01));
  const marginTop = Math.round(imageData.height * 0.09);
  const marginBottom = Math.round(imageData.height * 0.14);
  const x0 = clamp(left.x + left.width - marginX, 0, imageData.width - 1);
  const x1 = clamp(right.x + marginX, x0 + 1, imageData.width);
  const y0 = clamp(
    Math.min(left.y, right.y) - marginTop,
    0,
    imageData.height - 1
  );
  const y1 = clamp(
    Math.max(left.y + left.height, right.y + right.height) + marginBottom,
    y0 + 1,
    imageData.height
  );
  const width = x1 - x0;
  const height = y1 - y0;
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = ((y + y0) * imageData.width + x + x0) * 4;
      const red = imageData.data[offset]!;
      const green = imageData.data[offset + 1]!;
      const blue = imageData.data[offset + 2]!;
      if (red < 90 && green < 120 && blue < 190 && blue - red > 15) {
        mask[y * width + x] = 1;
      }
    }
  }
  const largest = connectedComponents(mask, width, height, false, true).sort(
    (leftComponent, rightComponent) => rightComponent.area - leftComponent.area
  )[0];
  if (!largest || largest.area < width * height * 0.03) return null;
  return largest.width / largest.height >= 0.72 ? 2 : 1;
}

function loadPreparedImage(previewDataUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(new Error("เปิดภาพสำหรับอ่านตัวเลขในเครื่องไม่สำเร็จ"));
    image.src = previewDataUrl;
  });
}

function chooseMode(reads: ModeRead[]) {
  const valid = reads.filter(read => read.mode !== "unknown");
  if (!valid.length) return { mode: "unknown" as const, confidence: 0 };
  const agreeing = valid.filter(read => read.mode === valid[0]!.mode);
  if (agreeing.length === valid.length) {
    return {
      mode: valid[0]!.mode,
      confidence:
        agreeing.reduce((sum, read) => sum + read.confidence, 0) /
        agreeing.length,
    };
  }
  return valid.sort((left, right) => right.confidence - left.confidence)[0]!;
}

export async function scanMeterImageLocally(
  prepared: PreparedMeterImage,
  imageIndex = 0
): Promise<MeterImageScanResult> {
  const image = await loadPreparedImage(prepared.previewDataUrl);
  const analysisWidth = Math.min(512, image.naturalWidth);
  const analysisHeight = Math.max(
    1,
    Math.round(image.naturalHeight * (analysisWidth / image.naturalWidth))
  );
  const analysisCanvas = document.createElement("canvas");
  analysisCanvas.width = analysisWidth;
  analysisCanvas.height = analysisHeight;
  const context = analysisCanvas.getContext("2d", {
    alpha: false,
    willReadFrequently: true,
  });
  if (!context) throw new Error("อุปกรณ์นี้ไม่รองรับการอ่านภาพในเครื่อง");
  context.drawImage(image, 0, 0, analysisWidth, analysisHeight);
  const analysisData = context.getImageData(
    0,
    0,
    analysisWidth,
    analysisHeight
  );
  const displays = findMainDisplays(analysisData);
  if (!displays) {
    return {
      imageIndex,
      pumpNumber: null,
      mode: "unknown",
      screens: [],
      issue:
        "ระบบในเครื่องหา LCD หลักสองจอไม่ครบ กรุณาครอปภาพให้เห็นหน้าตู้ตรงและชัดขึ้น",
    };
  }

  const pumpNumber = detectPumpNumber(analysisData, displays[0], displays[1]);
  const left = readScreen(
    extractScreenImageData(image, analysisWidth, analysisHeight, displays[0]),
    "left"
  );
  const right = readScreen(
    extractScreenImageData(image, analysisWidth, analysisHeight, displays[1]),
    "right"
  );
  const chosenMode = chooseMode([left.mode, right.mode]);
  const screens = [left.screen, right.screen].map(screen => ({
    ...screen,
    confidence: Math.min(screen.confidence, chosenMode.confidence),
  }));
  const issues: string[] = [];
  if (pumpNumber == null) issues.push("อ่านหมายเลขตู้ไม่ได้");
  if (chosenMode.mode === "unknown") issues.push("อ่านโหมด L/P ไม่ได้");
  if (left.mode.mode !== right.mode.mode) {
    issues.push("ตัวอักษร L/P ของสองจออ่านได้ไม่ตรงกัน");
  }
  if (screens.some(screen => !screen.valid)) {
    issues.push("มีจอที่อ่านตัวเลขได้ไม่ครบ");
  } else if (screens.some(screen => screen.confidence < 0.72)) {
    issues.push("ผลอ่านในเครื่องมีความมั่นใจต่ำ กรุณาตรวจทาน");
  }

  return {
    imageIndex,
    pumpNumber,
    mode: chosenMode.mode,
    screens,
    issue: issues.join(" · "),
  };
}

export function shouldUseGeminiFallback(result: MeterImageScanResult) {
  return (
    result.pumpNumber == null ||
    result.mode === "unknown" ||
    result.screens.length !== 2 ||
    result.screens.some(screen => !screen.valid || screen.confidence < 0.72)
  );
}
