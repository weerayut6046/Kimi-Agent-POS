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
  glareRatio: number;
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

type DisplayCandidate = Bounds & {
  fill: number;
  colorConfidence: number;
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
type MeterIntensityChannel = "red" | "luminance" | "minimum";

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

function luminance(red: number, green: number, blue: number) {
  return Math.round(red * 0.299 + green * 0.587 + blue * 0.114);
}

function channelIntensity(
  data: Uint8ClampedArray,
  offset: number,
  channel: MeterIntensityChannel
) {
  if (channel === "red") return data[offset]!;
  const red = data[offset]!;
  const green = data[offset + 1]!;
  const blue = data[offset + 2]!;
  return channel === "minimum"
    ? Math.min(red, green, blue)
    : luminance(red, green, blue);
}

/**
 * Measures clipped, low-saturation highlights inside an extracted LCD screen.
 * A reflection raises all RGB channels, while a dark seven-segment stroke
 * normally keeps at least one channel low. The ratio is deliberately exposed
 * so callers can reject risky reads instead of inventing hidden digits.
 */
export function measureSpecularGlare(imageData: ImageData) {
  let highlights = 0;
  const pixels = imageData.width * imageData.height;
  for (let offset = 0; offset < imageData.data.length; offset += 4) {
    const red = imageData.data[offset]!;
    const green = imageData.data[offset + 1]!;
    const blue = imageData.data[offset + 2]!;
    const maximum = Math.max(red, green, blue);
    const minimum = Math.min(red, green, blue);
    const lightness = luminance(red, green, blue);
    if (lightness >= 218 && (minimum >= 198 || maximum - minimum <= 52)) {
      highlights += 1;
    }
  }
  return pixels ? highlights / pixels : 0;
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

function boundsOverlap(left: Bounds, right: Bounds) {
  const overlapWidth = Math.max(
    0,
    Math.min(left.x + left.width, right.x + right.width) -
      Math.max(left.x, right.x)
  );
  const overlapHeight = Math.max(
    0,
    Math.min(left.y + left.height, right.y + right.height) -
      Math.max(left.y, right.y)
  );
  const intersection = overlapWidth * overlapHeight;
  if (!intersection) return 0;
  return (
    intersection /
    (left.width * left.height + right.width * right.height - intersection)
  );
}

function displayCandidates(
  imageData: ImageData,
  predicate: (red: number, green: number, blue: number) => boolean,
  colorConfidence: number
) {
  const { width, height } = imageData;
  const mask = imageDataMask(imageData, predicate);
  return connectedComponents(mask, width, height, false, true)
    .filter(component => {
      const fill = component.area / (component.width * component.height);
      const aspectRatio = component.width / component.height;
      const centerY = component.y + component.height / 2;
      return (
        component.width >= width * 0.15 &&
        component.width <= width * 0.47 &&
        component.height >= height * 0.08 &&
        component.height <= height * 0.38 &&
        aspectRatio >= 1.05 &&
        aspectRatio <= 4.8 &&
        centerY <= height * 0.72 &&
        fill >= 0.18
      );
    })
    .map(component => ({
      ...component,
      fill: component.area / (component.width * component.height),
      colorConfidence,
    }));
}

function displayPairScore(
  first: DisplayCandidate,
  second: DisplayCandidate,
  imageWidth: number,
  imageHeight: number
) {
  const [left, right] = first.x <= second.x ? [first, second] : [second, first];
  const leftCenterX = left.x + left.width / 2;
  const rightCenterX = right.x + right.width / 2;
  const leftCenterY = left.y + left.height / 2;
  const rightCenterY = right.y + right.height / 2;
  const centerDistance = rightCenterX - leftCenterX;
  const widthSimilarity =
    Math.min(left.width, right.width) / Math.max(left.width, right.width);
  const heightSimilarity =
    Math.min(left.height, right.height) / Math.max(left.height, right.height);
  const verticalAlignment =
    1 - Math.abs(leftCenterY - rightCenterY) / imageHeight;
  const verticalOverlap =
    Math.max(
      0,
      Math.min(left.y + left.height, right.y + right.height) -
        Math.max(left.y, right.y)
    ) / Math.min(left.height, right.height);
  const pairSpan = right.x + right.width - left.x;

  if (
    centerDistance < imageWidth * 0.22 ||
    leftCenterX >= imageWidth * 0.58 ||
    rightCenterX <= imageWidth * 0.42 ||
    widthSimilarity < 0.48 ||
    heightSimilarity < 0.45 ||
    verticalOverlap < 0.28 ||
    pairSpan < imageWidth * 0.55
  ) {
    return Number.NEGATIVE_INFINITY;
  }

  const centerBalance =
    1 -
    Math.min(
      1,
      Math.abs((leftCenterX + rightCenterX) / 2 - imageWidth / 2) /
        (imageWidth * 0.35)
    );
  return (
    (left.colorConfidence + right.colorConfidence) * 1.4 +
    (left.fill + right.fill) * 0.45 +
    widthSimilarity * 1.25 +
    heightSimilarity * 1.25 +
    verticalAlignment * 1.1 +
    verticalOverlap * 0.8 +
    centerBalance * 0.55
  );
}

export function findMainDisplays(
  imageData: ImageData
): [Bounds, Bounds] | null {
  const { width, height } = imageData;
  const masks = [
    {
      confidence: 1,
      predicate: (red: number, green: number, blue: number) =>
        blue - red > 25 &&
        blue - green > 8 &&
        red > 90 &&
        green > 110 &&
        blue > 145,
    },
    {
      confidence: 0.82,
      predicate: (red: number, green: number, blue: number) => {
        const brightness = (red + green + blue) / 3;
        return (
          brightness >= 58 &&
          brightness <= 232 &&
          blue - red >= 7 &&
          blue - green >= -3 &&
          blue - red + (blue - green) >= 10
        );
      },
    },
    {
      confidence: 0.68,
      predicate: (red: number, green: number, blue: number) => {
        const brightness = (red + green + blue) / 3;
        const spread = Math.max(red, green, blue) - Math.min(red, green, blue);
        return (
          brightness >= 72 &&
          brightness <= 218 &&
          spread <= 72 &&
          blue - red >= 4 &&
          blue - green >= -4
        );
      },
    },
    {
      // จอที่สีฟ้าถูก white balance ของกล้องลดจนเกือบเป็นสีเทา
      confidence: 0.52,
      predicate: (red: number, green: number, blue: number) => {
        const brightness = luminance(red, green, blue);
        const spread = Math.max(red, green, blue) - Math.min(red, green, blue);
        return brightness >= 52 && brightness <= 210 && spread <= 34;
      },
    },
  ];

  const candidates: DisplayCandidate[] = [];
  for (const mask of masks) {
    for (const candidate of displayCandidates(
      imageData,
      mask.predicate,
      mask.confidence
    )) {
      const duplicateIndex = candidates.findIndex(
        existing => boundsOverlap(existing, candidate) >= 0.76
      );
      if (duplicateIndex < 0) {
        candidates.push(candidate);
      } else if (
        candidate.colorConfidence > candidates[duplicateIndex]!.colorConfidence
      ) {
        candidates[duplicateIndex] = candidate;
      }
    }
  }

  let best:
    | { left: DisplayCandidate; right: DisplayCandidate; score: number }
    | undefined;
  for (let firstIndex = 0; firstIndex < candidates.length; firstIndex += 1) {
    for (
      let secondIndex = firstIndex + 1;
      secondIndex < candidates.length;
      secondIndex += 1
    ) {
      const first = candidates[firstIndex]!;
      const second = candidates[secondIndex]!;
      const score = displayPairScore(first, second, width, height);
      if (!best || score > best.score) {
        const [left, right] =
          first.x <= second.x ? [first, second] : [second, first];
        best = { left, right, score };
      }
    }
  }
  return best && Number.isFinite(best.score) ? [best.left, best.right] : null;
}

function otsuThreshold(
  imageData: ImageData,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  channel: MeterIntensityChannel
) {
  const histogram = new Uint32Array(256);
  const pixels = (x1 - x0) * (y1 - y0);
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const offset = (y * imageData.width + x) * 4;
      const intensity = channelIntensity(imageData.data, offset, channel);
      histogram[intensity]! += 1;
    }
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
  return clamp(threshold + 4, 45, 105);
}

function roiMask(
  imageData: ImageData,
  left: number,
  top: number,
  right: number,
  bottom: number,
  options: {
    channel: MeterIntensityChannel;
    localOffset: number;
    globalAllowance: number;
    adaptive: boolean;
  } = {
    channel: "red",
    localOffset: 8,
    globalAllowance: 18,
    adaptive: true,
  }
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
  const threshold = otsuThreshold(imageData, x0, y0, x1, y1, options.channel);
  const integralWidth = width + 1;
  const integral = new Uint32Array(integralWidth * (height + 1));
  for (let y = 0; y < height; y += 1) {
    let rowSum = 0;
    for (let x = 0; x < width; x += 1) {
      const sourceOffset = ((y + y0) * imageData.width + x + x0) * 4;
      rowSum += channelIntensity(
        imageData.data,
        sourceOffset,
        options.channel
      );
      integral[(y + 1) * integralWidth + x + 1] =
        integral[y * integralWidth + x + 1]! + rowSum;
    }
  }
  const radius = Math.max(6, Math.round(height * 0.15));
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sourceOffset = ((y + y0) * imageData.width + x + x0) * 4;
      const localX0 = Math.max(0, x - radius);
      const localY0 = Math.max(0, y - radius);
      const localX1 = Math.min(width, x + radius + 1);
      const localY1 = Math.min(height, y + radius + 1);
      const localSum =
        integral[localY1 * integralWidth + localX1]! -
        integral[localY0 * integralWidth + localX1]! -
        integral[localY1 * integralWidth + localX0]! +
        integral[localY0 * integralWidth + localX0]!;
      const localMean = localSum / ((localX1 - localX0) * (localY1 - localY0));
      const intensity = channelIntensity(
        imageData.data,
        sourceOffset,
        options.channel
      );
      if (
        (!options.adaptive || intensity < localMean - options.localOffset) &&
        intensity < threshold + options.globalAllowance
      ) {
        mask[y * width + x] = 1;
      }
    }
  }
  return { mask, width, height };
}

const MASK_PASSES = [
  {
    channel: "red",
    localOffset: 5,
    globalAllowance: 24,
    adaptive: true,
  },
  {
    channel: "red",
    localOffset: 9,
    globalAllowance: 18,
    adaptive: true,
  },
  {
    channel: "luminance",
    localOffset: 6,
    globalAllowance: 22,
    adaptive: true,
  },
  {
    channel: "luminance",
    localOffset: 11,
    globalAllowance: 16,
    adaptive: true,
  },
  {
    channel: "luminance",
    localOffset: 0,
    globalAllowance: 4,
    adaptive: false,
  },
  {
    channel: "minimum",
    localOffset: 7,
    globalAllowance: 22,
    adaptive: true,
  },
  {
    channel: "minimum",
    localOffset: 0,
    globalAllowance: 7,
    adaptive: false,
  },
] as const;

function roiMaskPasses(
  imageData: ImageData,
  left: number,
  top: number,
  right: number,
  bottom: number
) {
  return MASK_PASSES.map(options =>
    roiMask(imageData, left, top, right, bottom, options)
  );
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

function readSegments(
  mask: Uint8Array,
  width: number,
  height: number
): {
  active: Segment[];
  density: Record<Segment, number>;
} {
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
  return {
    active: (Object.keys(density) as Segment[]).filter(segment =>
      ["a", "g", "d"].includes(segment)
        ? density[segment] >= horizontalThreshold
        : density[segment] >= verticalThreshold
    ),
    density,
  };
}

function activeSegments(
  mask: Uint8Array,
  width: number,
  height: number
): Segment[] {
  return readSegments(mask, width, height).active;
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
    area: number;
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
      bounds.width < input.height * 0.045
    ) {
      continue;
    }

    if (bounds.width / bounds.height < 0.34) {
      decoded.push({
        x: bounds.x + bounds.width / 2,
        character: "1",
        confidence: 0.94,
        area: bounds.area,
      });
      continue;
    }

    const digitMask = maskBounds(mask, input.width, bounds);
    const segments = readSegments(
      digitMask.mask,
      digitMask.width,
      digitMask.height
    );
    let match = matchSevenSegmentDigit(segments.active);
    const activeKey = segments.active.slice().sort().join("");
    if (
      activeKey === "bce" &&
      segments.density.e >= 0.32 &&
      segments.density.f < 0.12
    ) {
      match = { digit: "2", distance: 0.45 };
    } else if (
      activeKey === "abcdefg" &&
      segments.density.e <
        Math.max(segments.density.f, segments.density.c) * 0.62
    ) {
      match = { digit: "9", distance: 0.45 };
    } else if (
      activeKey === "abcd" &&
      segments.density.g < 0.18 &&
      segments.density.d < 0.45
    ) {
      match = { digit: "7", distance: 0.45 };
    }
    decoded.push({
      x: bounds.x + bounds.width / 2,
      character: match.digit,
      confidence: clamp(0.96 - match.distance * 0.18, 0.35, 0.96),
      area: bounds.area,
    });
  }

  decoded.sort((left, right) => left.x - right.x);
  if (
    includeDecimal &&
    decoded.length >= 2 &&
    decoded[0]!.x < input.height * 0.16 &&
    decoded[1]!.x - decoded[0]!.x < input.height * 0.55
  ) {
    decoded.shift();
  } else if (!includeDecimal && decoded.length > 2) {
    const strongest = decoded
      .slice()
      .sort((left, right) => right.area - left.area)
      .slice(0, 2);
    decoded.splice(0, decoded.length, ...strongest);
  }

  if (decimalX != null) {
    decoded.push({
      x: decimalX,
      character: ".",
      confidence: 0.96,
      area: 0,
    });
  }
  decoded.sort((left, right) => left.x - right.x);
  return {
    text: decoded.map(item => item.character).join(""),
    confidence: decoded.length
      ? Math.min(...decoded.map(item => item.confidence))
      : 0,
  };
}

function digitReadShapeScore(read: DigitRead, includeDecimal: boolean) {
  if (!read.text) return -1;
  if (includeDecimal) {
    if (!/^\d{1,10}(?:\.\d{1,3})?$/.test(read.text)) return -0.75;
    const [integerPart, decimalPart] = read.text.split(".");
    return (
      (integerPart!.length >= 4 ? 0.14 : 0) +
      (decimalPart?.length === 2 ? 0.22 : decimalPart ? 0.08 : 0)
    );
  }
  return /^\d{1,2}$/.test(read.text) ? 0.16 : -0.5;
}

function chooseDigitRead(
  reads: DigitRead[],
  includeDecimal: boolean
): DigitRead {
  const groups = new Map<string, DigitRead[]>();
  for (const read of reads) {
    const group = groups.get(read.text) ?? [];
    group.push(read);
    groups.set(read.text, group);
  }

  const ranked = [...groups.entries()]
    .map(([text, group]) => {
      const averageConfidence =
        group.reduce((total, read) => total + read.confidence, 0) /
        group.length;
      const agreement = group.length / Math.max(1, reads.length);
      return {
        text,
        averageConfidence,
        agreement,
        score:
          averageConfidence * 0.62 +
          agreement * 0.55 +
          digitReadShapeScore(group[0]!, includeDecimal),
      };
    })
    .sort((left, right) => right.score - left.score);
  const best = ranked[0];
  if (!best || !best.text) return { text: "", confidence: 0 };
  return {
    text: best.text,
    confidence: clamp(
      best.averageConfidence * 0.72 + best.agreement * 0.28,
      0,
      0.98
    ),
  };
}

function decodeDigitsFromPasses(
  passes: Array<{ mask: Uint8Array; width: number; height: number }>,
  includeDecimal: boolean
) {
  return chooseDigitRead(
    passes.map(pass => decodeDigits(pass, includeDecimal)),
    includeDecimal
  );
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

function decodeModeFromPasses(
  passes: Array<{ mask: Uint8Array; width: number; height: number }>
): ModeRead {
  const reads = passes.map(decodeMode);
  const ranked = (["L", "P"] as const)
    .map(mode => {
      const matching = reads.filter(read => read.mode === mode);
      const agreement = matching.length / Math.max(1, reads.length);
      const averageConfidence = matching.length
        ? matching.reduce((total, read) => total + read.confidence, 0) /
          matching.length
        : 0;
      return {
        mode,
        agreement,
        averageConfidence,
        score: agreement * 0.65 + averageConfidence * 0.35,
      };
    })
    .sort((left, right) => right.score - left.score);
  const best = ranked[0]!;
  if (best.agreement < 0.4) return { mode: "unknown", confidence: 0 };
  return {
    mode: best.mode,
    confidence: clamp(
      best.averageConfidence * 0.7 + best.agreement * 0.3,
      0.25,
      0.98
    ),
  };
}

export function readMeterScreenImageData(
  imageData: ImageData,
  side: MeterDisplaySide
): { screen: MeterImageScanScreen; mode: ModeRead } {
  const glareRatio = measureSpecularGlare(imageData);
  const mainRead = decodeDigitsFromPasses(
    roiMaskPasses(imageData, 0.02, 0.4, 0.98, 0.99).map(cropRowsToLongestRun),
    true
  );
  const prefixRead = decodeDigitsFromPasses(
    roiMaskPasses(imageData, 0.48, 0.04, 1, 0.48),
    false
  );
  const mode = decodeModeFromPasses(
    roiMaskPasses(imageData, 0.02, 0.04, 0.32, 0.52)
  );
  const combined = combineMeterDisplayDigits(prefixRead.text, mainRead.text);
  const glarePenalty = clamp((glareRatio - 0.025) * 2.4, 0, 0.48);

  return {
    screen: {
      side,
      prefixDigits: prefixRead.text,
      mainDigits: mainRead.text,
      combinedText: combined?.combinedText ?? null,
      value: combined?.value ?? null,
      confidence:
        Math.min(mainRead.confidence, prefixRead.confidence) *
        (1 - glarePenalty),
      glareRatio,
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

function assessImageQuality(imageData: ImageData) {
  const { width, height, data } = imageData;
  const step = 2;
  let samples = 0;
  let sum = 0;
  let sumSquared = 0;
  let clippedDark = 0;
  let clippedBright = 0;
  let edgeEnergy = 0;
  let edgeSamples = 0;
  for (let y = step; y < height; y += step) {
    for (let x = step; x < width; x += step) {
      const offset = (y * width + x) * 4;
      const value = luminance(
        data[offset]!,
        data[offset + 1]!,
        data[offset + 2]!
      );
      const leftOffset = (y * width + x - step) * 4;
      const topOffset = ((y - step) * width + x) * 4;
      const left = luminance(
        data[leftOffset]!,
        data[leftOffset + 1]!,
        data[leftOffset + 2]!
      );
      const top = luminance(
        data[topOffset]!,
        data[topOffset + 1]!,
        data[topOffset + 2]!
      );
      samples += 1;
      sum += value;
      sumSquared += value * value;
      if (value <= 12) clippedDark += 1;
      if (value >= 243) clippedBright += 1;
      edgeEnergy += Math.abs(value - left) + Math.abs(value - top);
      edgeSamples += 2;
    }
  }
  if (!samples) return [];
  const mean = sum / samples;
  const deviation = Math.sqrt(Math.max(0, sumSquared / samples - mean ** 2));
  const clippedRatio = (clippedDark + clippedBright) / samples;
  const averageEdge = edgeEnergy / Math.max(1, edgeSamples);
  const issues: string[] = [];
  if (mean < 42) issues.push("ภาพมืดมาก ควรถ่ายใหม่ในที่สว่างขึ้น");
  if (mean > 222 || clippedRatio > 0.34) {
    issues.push("ภาพสว่างจ้าหรือมีแสงสะท้อนมาก");
  }
  if (deviation < 18 || averageEdge < 2.4) {
    issues.push("ภาพมีคอนทราสต์หรือความคมชัดต่ำ");
  }
  return issues;
}

function chooseMode(reads: ModeRead[]) {
  const valid = reads.filter(read => read.mode !== "unknown");
  if (!valid.length) return { mode: "unknown" as const, confidence: 0 };
  const agreeing = valid.filter(read => read.mode === valid[0]!.mode);
  if (agreeing.length === valid.length) {
    const combinedConfidence = agreeing.reduce(
      (probability, read) => probability * (1 - read.confidence),
      1
    );
    return {
      mode: valid[0]!.mode,
      confidence: clamp(1 - combinedConfidence, 0.25, 0.98),
    };
  }
  return valid.sort((left, right) => right.confidence - left.confidence)[0]!;
}

export async function scanMeterImageLocally(
  prepared: PreparedMeterImage,
  imageIndex = 0
): Promise<MeterImageScanResult> {
  const image = await loadPreparedImage(prepared.previewDataUrl);
  // ความกว้างระดับนี้ยังทำงานได้เร็วบนมือถือ แต่รักษาขอบ LCD และกรอบจอ
  // ได้ดีกว่าภาพวิเคราะห์ 512 px โดยเฉพาะภาพที่ถ่ายทั้งตู้
  const analysisWidth = Math.min(896, image.naturalWidth);
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
  const qualityIssues = assessImageQuality(analysisData);
  const displays = findMainDisplays(analysisData);
  if (!displays) {
    return {
      imageIndex,
      pumpNumber: null,
      mode: "unknown",
      screens: [],
      issue: [
        ...qualityIssues,
        "ระบบในเครื่องหา LCD หลักสองจอไม่ครบ กรุณาครอปภาพให้เห็นหน้าตู้ตรงและชัดขึ้น",
      ].join(" · "),
    };
  }

  const pumpNumber = detectPumpNumber(analysisData, displays[0], displays[1]);
  const left = readMeterScreenImageData(
    extractScreenImageData(image, analysisWidth, analysisHeight, displays[0]),
    "left"
  );
  const right = readMeterScreenImageData(
    extractScreenImageData(image, analysisWidth, analysisHeight, displays[1]),
    "right"
  );
  const chosenMode = chooseMode([left.mode, right.mode]);
  const screens = [left.screen, right.screen].map(screen => ({
    ...screen,
    confidence: Math.min(screen.confidence, chosenMode.confidence),
  }));
  const issues: string[] = [...qualityIssues];
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
  if (screens.some(screen => screen.glareRatio >= 0.08)) {
    issues.push(
      "พบแสงสะท้อนบน LCD กรุณาถ่ายเพิ่มโดยขยับมุม 5–10° ให้เงาเคลื่อนตำแหน่ง"
    );
  }

  return {
    imageIndex,
    pumpNumber,
    mode: chosenMode.mode,
    screens,
    issue: issues.join(" · "),
  };
}
