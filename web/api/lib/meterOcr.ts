import { z } from "zod";
import {
  combineMeterDisplayDigits,
  type MeterDisplayMode,
  type MeterDisplaySide,
} from "@contracts/meterOcr";

const DEFAULT_TIMEOUT_MS = 45_000;

const providerScreenSchema = z
  .object({
    side: z.enum(["left", "right"]),
    prefixDigits: z.string().max(6),
    mainDigits: z.string().max(16),
    confidence: z.number().min(0).max(1),
  })
  .strict();

const providerImageSchema = z
  .object({
    imageIndex: z.number().int().nonnegative(),
    pumpNumber: z.number().int().nonnegative().nullable(),
    mode: z.enum(["L", "P", "unknown"]),
    screens: z.array(providerScreenSchema).max(2),
    issue: z.string().max(300),
  })
  .strict();

const providerResultSchema = z
  .object({
    images: z.array(providerImageSchema).max(4),
  })
  .strict();

const structuredOutputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["images"],
  properties: {
    images: {
      type: "array",
      maxItems: 4,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["imageIndex", "pumpNumber", "mode", "screens", "issue"],
        properties: {
          imageIndex: { type: "integer", minimum: 0 },
          pumpNumber: {
            type: ["integer", "null"],
            minimum: 0,
          },
          mode: {
            type: "string",
            enum: ["L", "P", "unknown"],
          },
          screens: {
            type: "array",
            maxItems: 2,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["side", "prefixDigits", "mainDigits", "confidence"],
              properties: {
                side: {
                  type: "string",
                  enum: ["left", "right"],
                },
                prefixDigits: {
                  type: "string",
                  maxLength: 6,
                },
                mainDigits: {
                  type: "string",
                  maxLength: 16,
                },
                confidence: {
                  type: "number",
                  minimum: 0,
                  maximum: 1,
                },
              },
            },
          },
          issue: {
            type: "string",
            maxLength: 300,
          },
        },
      },
    },
  },
} as const;

const SYSTEM_PROMPT = `อ่านเลขมิเตอร์สะสมจากภาพหน้าตู้จ่ายน้ำมันเท่านั้น

ภาพหนึ่งมักมีเลขตู้ขนาดใหญ่อยู่กึ่งกลางและจอ LCD สองจอ (ซ้าย/ขวา)
โหมดของภาพแสดงตัวอักษร L หรือ P:
- L คือมิเตอร์ลิตรสะสม
- P คือมิเตอร์บาทสะสม

ข้อสำคัญที่สุด: เลขด้านขวาบนถัดจาก L/P เป็นหลักนำหน้าของเลขมิเตอร์เดียวกัน
ต้องแยกออกมาเป็น prefixDigits และอ่านเลขบรรทัดล่างเป็น mainDigits
ตัวอย่าง L 39 ด้านบนและ 6962.39 ด้านล่าง หมายถึง 396962.39
รักษาเลขศูนย์นำหน้าของ mainDigits เสมอ เช่น 42 + 0105.81

อย่าอ่านจอราคาขนาดเล็กด้านล่างที่มีคำว่า "ลิตรละ" หรือ "บาท"
อย่าเดาตัวเลขที่มองไม่ชัด ให้ลด confidence และอธิบายใน issue
คืนผลของทุกภาพตาม imageIndex ที่กำกับไว้ และไม่ต้องคำนวณเลขรวม`;

export type MeterOcrInputImage = {
  contentBase64: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
};

export type MeterOcrScreen = {
  side: MeterDisplaySide;
  prefixDigits: string;
  mainDigits: string;
  combinedText: string | null;
  value: number | null;
  confidence: number;
  valid: boolean;
};

export type MeterOcrImageResult = {
  imageIndex: number;
  pumpNumber: number | null;
  mode: MeterDisplayMode;
  screens: MeterOcrScreen[];
  issue: string;
};

type MeterOcrErrorKind =
  | "not_configured"
  | "timeout"
  | "rate_limited"
  | "upstream"
  | "invalid_response";

export class MeterOcrError extends Error {
  readonly kind: MeterOcrErrorKind;

  constructor(kind: MeterOcrErrorKind, message: string) {
    super(message);
    this.kind = kind;
    this.name = "MeterOcrError";
  }
}

function responseOutputText(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  if (typeof record.output_text === "string") return record.output_text;

  const outputCollections = [record.steps, record.output, record.outputs];
  for (const collection of outputCollections) {
    if (!Array.isArray(collection)) continue;
    for (
      let outputIndex = collection.length - 1;
      outputIndex >= 0;
      outputIndex--
    ) {
      const output = collection[outputIndex];
      if (!output || typeof output !== "object") continue;
      const outputRecord = output as Record<string, unknown>;
      if (
        typeof outputRecord.type === "string" &&
        !["model_output", "message", "output_text"].includes(outputRecord.type)
      ) {
        continue;
      }
      const content = outputRecord.content;
      if (!Array.isArray(content)) continue;
      const textParts: string[] = [];
      for (const item of content) {
        if (!item || typeof item !== "object") continue;
        const itemRecord = item as Record<string, unknown>;
        if (
          (itemRecord.type === "text" || itemRecord.type === "output_text") &&
          typeof itemRecord.text === "string"
        ) {
          textParts.push(itemRecord.text);
        }
      }
      if (textParts.length) return textParts.join("");
    }
  }
  return null;
}

function normalizeResult(
  raw: z.infer<typeof providerResultSchema>,
  imageCount: number
): MeterOcrImageResult[] {
  const byIndex = new Map<number, z.infer<typeof providerImageSchema>>();
  for (const image of raw.images) {
    if (image.imageIndex >= imageCount || byIndex.has(image.imageIndex)) {
      continue;
    }
    byIndex.set(image.imageIndex, image);
  }

  return Array.from({ length: imageCount }, (_, imageIndex) => {
    const image = byIndex.get(imageIndex);
    if (!image) {
      return {
        imageIndex,
        pumpNumber: null,
        mode: "unknown" as const,
        screens: [],
        issue: "AI ไม่ได้ส่งผลลัพธ์ของภาพนี้กลับมา",
      };
    }

    const seenSides = new Set<MeterDisplaySide>();
    const screens: MeterOcrScreen[] = [];
    for (const screen of image.screens) {
      if (seenSides.has(screen.side)) continue;
      seenSides.add(screen.side);
      const combined = combineMeterDisplayDigits(
        screen.prefixDigits,
        screen.mainDigits
      );
      screens.push({
        side: screen.side,
        prefixDigits: screen.prefixDigits.trim(),
        mainDigits: screen.mainDigits.trim(),
        combinedText: combined?.combinedText ?? null,
        value: combined?.value ?? null,
        confidence: screen.confidence,
        valid: combined != null,
      });
    }

    return {
      imageIndex,
      pumpNumber: image.pumpNumber,
      mode: image.mode,
      screens,
      issue: image.issue.trim(),
    };
  });
}

function safeGeminiUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:") {
      throw new Error("Meter OCR endpoint must use HTTPS");
    }
    return url.toString();
  } catch {
    throw new MeterOcrError(
      "not_configured",
      "GEMINI_API_URL ไม่ใช่ HTTPS URL ที่ถูกต้อง"
    );
  }
}

export async function readMeterImages(input: {
  apiKey: string;
  apiUrl: string;
  model: string;
  images: MeterOcrInputImage[];
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<MeterOcrImageResult[]> {
  if (!input.apiKey.trim()) {
    throw new MeterOcrError(
      "not_configured",
      "ยังไม่ได้ตั้งค่า GEMINI_API_KEY"
    );
  }
  if (!input.images.length) return [];

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    input.timeoutMs ?? DEFAULT_TIMEOUT_MS
  );
  const fetchImpl = input.fetchImpl ?? fetch;

  try {
    const response = await fetchImpl(safeGeminiUrl(input.apiUrl), {
      method: "POST",
      headers: {
        "x-goog-api-key": input.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: input.model,
        input: [
          {
            type: "text",
            text: SYSTEM_PROMPT,
          },
          ...input.images.flatMap((image, imageIndex) => [
            {
              type: "text",
              text: `IMAGE_INDEX=${imageIndex}`,
            },
            {
              type: "image",
              data: image.contentBase64,
              mime_type: image.mimeType,
            },
          ]),
        ],
        response_format: {
          type: "text",
          mime_type: "application/json",
          schema: structuredOutputSchema,
        },
        generation_config: {
          thinking_level: "minimal",
        },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      console.error("Meter OCR request failed", {
        provider: "gemini",
        status: response.status,
        requestId: response.headers.get("x-request-id") ?? undefined,
      });
      if (response.status === 429) {
        throw new MeterOcrError(
          "rate_limited",
          "Gemini API quota or rate limit was exceeded"
        );
      }
      throw new MeterOcrError(
        "upstream",
        `บริการอ่านภาพตอบกลับ HTTP ${response.status}`
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new MeterOcrError(
        "invalid_response",
        "บริการอ่านภาพไม่ได้ส่ง JSON กลับมา"
      );
    }
    const outputText = responseOutputText(payload);
    if (!outputText) {
      throw new MeterOcrError(
        "invalid_response",
        "บริการอ่านภาพไม่ได้ส่งผลลัพธ์ตัวเลขกลับมา"
      );
    }

    let decoded: unknown;
    try {
      decoded = JSON.parse(outputText);
    } catch {
      throw new MeterOcrError(
        "invalid_response",
        "ผลลัพธ์อ่านภาพไม่ใช่ JSON ที่ถูกต้อง"
      );
    }
    const parsed = providerResultSchema.safeParse(decoded);
    if (!parsed.success) {
      throw new MeterOcrError(
        "invalid_response",
        "ผลลัพธ์อ่านภาพมีรูปแบบไม่ถูกต้อง"
      );
    }
    return normalizeResult(parsed.data, input.images.length);
  } catch (error) {
    if (error instanceof MeterOcrError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new MeterOcrError("timeout", "บริการอ่านภาพใช้เวลานานเกินไป");
    }
    throw new MeterOcrError("upstream", "เชื่อมต่อบริการอ่านภาพไม่สำเร็จ");
  } finally {
    clearTimeout(timer);
  }
}
