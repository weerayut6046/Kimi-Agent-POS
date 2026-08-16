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
  .object({ images: z.array(providerImageSchema).max(4) })
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
          pumpNumber: { type: ["integer", "null"], minimum: 0 },
          mode: { type: "string", enum: ["L", "P", "unknown"] },
          screens: {
            type: "array",
            maxItems: 2,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["side", "prefixDigits", "mainDigits", "confidence"],
              properties: {
                side: { type: "string", enum: ["left", "right"] },
                prefixDigits: { type: "string", maxLength: 6 },
                mainDigits: { type: "string", maxLength: 16 },
                confidence: { type: "number", minimum: 0, maximum: 1 },
              },
            },
          },
          issue: { type: "string", maxLength: 300 },
        },
      },
    },
  },
} as const;

const SYSTEM_PROMPT = `คุณเป็นผู้ตรวจสอบภาพมิเตอร์ตู้จ่ายน้ำมันแบบอิสระ
อ่านเฉพาะสิ่งที่มองเห็นในภาพ ห้ามคำนวณ ห้ามเติมเลขที่ถูกเงาหรือแสงสะท้อนบัง และห้ามเดาจากภาพอื่น

ภาพหนึ่งมักมีเลขตู้กึ่งกลางและ LCD สองจอซ้าย/ขวา โหมดแสดง L (ลิตร) หรือ P (บาท)
เลขด้านขวาบนถัดจาก L/P คือ prefixDigits และเลขบรรทัดล่างคือ mainDigits ของมิเตอร์เดียวกัน
รักษาเลขศูนย์นำหน้าทุกหลัก แต่อย่าต่อเลขสองส่วนเข้าด้วยกันในคำตอบ
อย่าอ่านจอราคาขนาดเล็กที่มีคำว่า "ลิตรละ" หรือ "บาท"

ถ้ามองเลขใดไม่ครบ ให้คืนข้อความว่างสำหรับส่วนนั้น ลด confidence และอธิบายสั้น ๆ ใน issue
คืนผลทุกภาพตาม IMAGE_INDEX และไม่ใช้ค่าจาก OCR หรือคำตอบก่อนหน้า`;

export type MeterAiInputImage = {
  contentBase64: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
};

export type MeterAiScreenResult = {
  side: MeterDisplaySide;
  prefixDigits: string;
  mainDigits: string;
  combinedText: string | null;
  confidence: number;
  valid: boolean;
};

export type MeterAiImageResult = {
  imageIndex: number;
  pumpNumber: number | null;
  mode: MeterDisplayMode;
  screens: MeterAiScreenResult[];
  issue: string;
};

export type MeterAiVerifierErrorKind =
  | "not_configured"
  | "timeout"
  | "rate_limited"
  | "upstream"
  | "invalid_response";

export class MeterAiVerifierError extends Error {
  readonly kind: MeterAiVerifierErrorKind;

  constructor(kind: MeterAiVerifierErrorKind, message: string) {
    super(message);
    this.kind = kind;
    this.name = "MeterAiVerifierError";
  }
}

function responseOutputText(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  if (typeof record.output_text === "string") return record.output_text;

  for (const collection of [record.steps, record.output, record.outputs]) {
    if (!Array.isArray(collection)) continue;
    for (let index = collection.length - 1; index >= 0; index -= 1) {
      const output = collection[index];
      if (!output || typeof output !== "object") continue;
      const content = (output as Record<string, unknown>).content;
      if (!Array.isArray(content)) continue;
      const text = content
        .filter(item => item && typeof item === "object")
        .map(item => item as Record<string, unknown>)
        .filter(item =>
          ["text", "output_text"].includes(String(item.type ?? ""))
        )
        .map(item => item.text)
        .filter((value): value is string => typeof value === "string")
        .join("");
      if (text) return text;
    }
  }
  return null;
}

function normalizeResult(
  raw: z.infer<typeof providerResultSchema>,
  imageCount: number
): MeterAiImageResult[] {
  const byIndex = new Map<number, z.infer<typeof providerImageSchema>>();
  for (const image of raw.images) {
    if (image.imageIndex < imageCount && !byIndex.has(image.imageIndex)) {
      byIndex.set(image.imageIndex, image);
    }
  }

  return Array.from({ length: imageCount }, (_, imageIndex) => {
    const image = byIndex.get(imageIndex);
    if (!image) {
      return {
        imageIndex,
        pumpNumber: null,
        mode: "unknown" as const,
        screens: [],
        issue: "AI ไม่ได้ส่งผลตรวจของภาพนี้กลับมา",
      };
    }

    const seenSides = new Set<MeterDisplaySide>();
    const screens: MeterAiScreenResult[] = [];
    for (const screen of image.screens) {
      if (seenSides.has(screen.side)) continue;
      seenSides.add(screen.side);
      const prefixDigits = screen.prefixDigits.trim();
      const mainDigits = screen.mainDigits.trim();
      const combined = combineMeterDisplayDigits(prefixDigits, mainDigits);
      screens.push({
        side: screen.side,
        prefixDigits,
        mainDigits,
        combinedText: combined?.combinedText ?? null,
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

function safeGeminiUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:") throw new Error("HTTPS required");
    return url.toString();
  } catch {
    throw new MeterAiVerifierError(
      "not_configured",
      "GEMINI_METER_VERIFY_API_URL ไม่ถูกต้อง"
    );
  }
}

export async function verifyMeterImagesWithGemini(input: {
  apiKey: string;
  apiUrl: string;
  model: string;
  images: MeterAiInputImage[];
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<MeterAiImageResult[]> {
  if (!input.apiKey.trim()) {
    throw new MeterAiVerifierError(
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
  try {
    const response = await (input.fetchImpl ?? fetch)(
      safeGeminiUrl(input.apiUrl),
      {
        method: "POST",
        headers: {
          "x-goog-api-key": input.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: input.model,
          store: false,
          input: [
            { type: "text", text: SYSTEM_PROMPT },
            ...input.images.flatMap((image, imageIndex) => [
              { type: "text", text: `IMAGE_INDEX=${imageIndex}` },
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
            thinking_level: "medium",
            max_output_tokens: 2_048,
          },
        }),
        signal: controller.signal,
      }
    );

    if (!response.ok) {
      console.error("Meter AI verification request failed", {
        provider: "gemini",
        status: response.status,
        requestId: response.headers.get("x-request-id") ?? undefined,
      });
      if (response.status === 429) {
        throw new MeterAiVerifierError(
          "rate_limited",
          "Gemini API quota or rate limit was exceeded"
        );
      }
      throw new MeterAiVerifierError(
        "upstream",
        `บริการ AI ตอบกลับ HTTP ${response.status}`
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new MeterAiVerifierError(
        "invalid_response",
        "บริการ AI ไม่ได้ส่ง JSON กลับมา"
      );
    }
    const outputText = responseOutputText(payload);
    if (!outputText) {
      throw new MeterAiVerifierError(
        "invalid_response",
        "บริการ AI ไม่ได้ส่งผลตรวจกลับมา"
      );
    }

    let decoded: unknown;
    try {
      decoded = JSON.parse(outputText);
    } catch {
      throw new MeterAiVerifierError(
        "invalid_response",
        "ผลตรวจ AI ไม่ใช่ JSON ที่ถูกต้อง"
      );
    }
    const parsed = providerResultSchema.safeParse(decoded);
    if (!parsed.success) {
      throw new MeterAiVerifierError(
        "invalid_response",
        "ผลตรวจ AI มีรูปแบบไม่ถูกต้อง"
      );
    }
    return normalizeResult(parsed.data, input.images.length);
  } catch (error) {
    if (error instanceof MeterAiVerifierError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new MeterAiVerifierError("timeout", "บริการ AI ใช้เวลานานเกินไป");
    }
    throw new MeterAiVerifierError("upstream", "เชื่อมต่อบริการ AI ไม่สำเร็จ");
  } finally {
    clearTimeout(timer);
  }
}
