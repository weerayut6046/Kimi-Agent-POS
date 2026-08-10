import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, gte, ne, sql } from "drizzle-orm";
import {
  securityEvents,
  securityReports,
  type SecurityEvent,
} from "@db/schema";
import { getDb } from "../queries/connection";
import {
  AssistantSecretError,
  getAssistantRuntimeConfig,
} from "./assistantConfig";
import { DeepSeekAssistantError, runDeepSeekAssistant } from "./deepseek";
import { OllamaAssistantError, runOllamaAssistant } from "./ollama";

const MAX_ANALYSIS_EVENTS = 30;
const MAX_PROMPT_CHARS = 8_000;

const NO_EVENTS_ANSWER =
  "ไม่พบเหตุการณ์ความปลอดภัยที่ยังไม่ได้จัดการในช่วงเวลานี้ ระบบอยู่ในเกณฑ์ปลอดภัยตามกฎที่ตรวจ";

function systemPrompt() {
  return `คุณคือผู้เชี่ยวชาญความปลอดภัยของระบบ POS ปั๊มน้ำมัน (PumpPOS) วิเคราะห์เหตุการณ์ความปลอดภัยที่ระบบตรวจกฎส่งให้เท่านั้น และตอบเป็นภาษาไทยกระชาก

ข้อกำหนดสำคัญ:
- ห้ามแต่งเหตุการณ์หรือยืนยันสาเหตุที่ไม่มีหลักฐาน ให้ใช้คำว่า "สาเหตุที่เป็นไปได้"
- ให้ความสำคัญกับ critical ก่อน โดยเฉพาะ login สำเร็จหลังพยายามผิดพลาดหลายครั้ง
- แนวทางรับมือต้องทำได้ทันทีโดยผู้ดูแลระบบปั๊ม ไม่ต้องแก้โค้ด

จัดคำตอบเป็นหัวข้อตามนี้:
## สรุปภาพรวม
## เหตุการณ์ที่น่าเป็นห่วงที่สุด 3 อันดับ
## แนวทางรับมือที่ทำได้ทันที`;
}

function bangkokTime(date: Date): string {
  return date.toLocaleString("th-TH", {
    timeZone: "Asia/Bangkok",
    dateStyle: "short",
    timeStyle: "short",
  });
}

/** เรียงเหตุการณ์เป็นบรรทัดสั้นๆ ไม่เกิน MAX_PROMPT_CHARS รวม */
function serializeEvents(events: SecurityEvent[]): string {
  const lines = events.map(event => {
    const keyDetails = Object.entries(event.detail)
      .filter(([, value]) =>
        ["string", "number", "boolean"].includes(typeof value)
      )
      .slice(0, 4)
      .map(([key, value]) => `${key}=${String(value).slice(0, 60)}`)
      .join(" ");
    return [
      `[${bangkokTime(event.createdAt)}]`,
      `${event.severity}/${event.category}`,
      `${event.rule}: ${event.title}`,
      `| ผู้เกี่ยวข้อง: ${event.actorName || "-"}`,
      keyDetails ? `| ${keyDetails}` : "",
    ]
      .filter(Boolean)
      .join(" ");
  });
  const prompt = `เหตุการณ์ ${events.length} รายการ (เรียง critical ก่อน แล้วตามเวลาล่าสุด):\n${lines.join("\n")}`;
  return prompt.length <= MAX_PROMPT_CHARS
    ? prompt
    : `${prompt.slice(0, MAX_PROMPT_CHARS)}\n…(ตัดทอน)`;
}

/**
 * ให้ AI วิเคราะห์ security events ที่ยังไม่ปิดของสาขา แล้วเก็บรายงานภาษาไทย
 * ลง security_reports — error ของ provider ถูกแปลงเป็น TRPCError ตามแบบ assistant
 */
export async function analyzeSecurityEvents(input: {
  branchId: number;
  windowDays: number;
  fetchImpl?: typeof fetch;
}): Promise<{ answer: string; reportId: number }> {
  const db = getDb();
  const since = new Date(Date.now() - input.windowDays * 24 * 3_600_000);
  const events = await db
    .select()
    .from(securityEvents)
    .where(
      and(
        eq(securityEvents.branchId, input.branchId),
        ne(securityEvents.status, "resolved"),
        gte(securityEvents.createdAt, since)
      )
    )
    .orderBy(
      asc(
        sql`CASE WHEN ${securityEvents.severity} = 'critical' THEN 0 WHEN ${securityEvents.severity} = 'warning' THEN 1 ELSE 2 END`
      ),
      desc(securityEvents.createdAt)
    )
    .limit(MAX_ANALYSIS_EVENTS);

  let answer: string;
  if (!events.length) {
    answer = NO_EVENTS_ANSWER;
  } else {
    let config: Awaited<ReturnType<typeof getAssistantRuntimeConfig>>;
    try {
      config = await getAssistantRuntimeConfig(input.branchId);
    } catch (error) {
      if (error instanceof AssistantSecretError) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: error.message,
        });
      }
      throw error;
    }
    if (config.provider === "deepseek" && !config.deepseekApiKey) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "ยังไม่ได้ตั้งค่า DeepSeek API Key กรุณาตั้งค่าในเมนู ตั้งค่าระบบ > AI",
      });
    }

    const prompt = serializeEvents(events);
    try {
      const result =
        config.provider === "ollama"
          ? await runOllamaAssistant({
              baseUrl: config.ollamaBaseUrl,
              model: config.ollamaModel,
              timeoutMs: config.ollamaTimeoutMs,
              systemPrompt: systemPrompt(),
              conversation: [{ role: "user", content: prompt }],
              tools: [],
              fetchImpl: input.fetchImpl,
            })
          : await runDeepSeekAssistant({
              apiKey: config.deepseekApiKey,
              model: config.deepseekModel,
              systemPrompt: systemPrompt(),
              conversation: [{ role: "user", content: prompt }],
              tools: [],
              fetchImpl: input.fetchImpl,
            });
      answer = result.answer;
    } catch (error) {
      if (
        (error instanceof DeepSeekAssistantError ||
          error instanceof OllamaAssistantError) &&
        error.kind === "timeout"
      ) {
        throw new TRPCError({
          code: "TIMEOUT",
          message: "AI ใช้เวลาวิเคราะห์นานเกินไป กรุณาลองใหม่",
        });
      }
      if (
        error instanceof OllamaAssistantError &&
        error.kind === "model_not_found"
      ) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `ยังไม่พบโมเดล ${config.ollamaModel} ใน Ollama`,
        });
      }
      if (
        error instanceof OllamaAssistantError &&
        error.kind === "unavailable"
      ) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "เชื่อมต่อ Ollama ไม่ได้ กรุณาเปิด Ollama แล้วลองใหม่",
        });
      }
      console.error("Security AI analysis failed", {
        kind:
          error instanceof DeepSeekAssistantError ||
          error instanceof OllamaAssistantError
            ? error.kind
            : "unexpected",
        provider: config.provider,
      });
      throw new TRPCError({
        code: "BAD_GATEWAY",
        message: "AI ยังไม่พร้อมวิเคราะห์ชั่วคราว กรุณาลองใหม่ภายหลัง",
      });
    }
  }

  const [report] = await db
    .insert(securityReports)
    .values({
      branchId: input.branchId,
      windowDays: input.windowDays,
      eventCount: events.length,
      answer,
    })
    .returning({ id: securityReports.id });
  return { answer, reportId: report.id };
}
