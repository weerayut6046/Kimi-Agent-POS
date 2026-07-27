/**
 * รับแจ้ง "เงินเข้า" จากแอปอ่าน notification บนมือถือของร้าน
 * (มือถือเครื่องที่ล็อกอินแอปถุงเงิน/ธนาคาร — เช่น ตังค์เข้า, PayNotify, MacroDroid)
 *
 * แอปยิง HTTP POST เข้ามาพร้อม token ของสาขา + ยอดเงิน → ระบบจับคู่กับ
 * payment session ที่รอชำระอยู่ (ยอดตรงเป๊ะ เหลือ 1 บิลเท่านั้น) แล้วปิดบิลอัตโนมัติ
 * — หน้าจอ POS poll สถานะอยู่แล้วจึงแจ้ง "เงินเข้าแล้ว" ทันทีโดยไม่ต้องสแกนสลิป
 *
 * ข้อจำกัดโดยตั้งใจ:
 * - ยอดเดียวกันค้าง 2 บิล → ไม่เดา ไม่ปิดบิล (แคชเชียร์สแกนสลิปตามเดิม)
 * - ไม่มีการยืนยันกับธนาคาร — ความถูกต้องขึ้นกับแอปแจ้งเตือนและความลับของ token
 * - แจ้งซ้ำ (ref เดิม) → คืนบิลเดิม ไม่สร้างบิลใหม่ (idempotent)
 */

import { and, eq } from "drizzle-orm";
import { paymentSessions, sales } from "@db/schema";
import { getDb } from "../queries/connection";
import { logAudit } from "../lib/audit";
import { publishRealtimeInvalidation } from "../lib/realtime";
import { getStoredWebhookToken } from "./paymentConfig";
import { finalizeThungngernSession } from "./sessionService";

const MAX_AMOUNT_BAHT = 1_000_000;
const WEBHOOK_REF_PREFIX = "wh:";
const MAX_REF_LENGTH = 64;

export type IncomingPaymentPayload = Record<string, unknown>;

export type IncomingPaymentResult = {
  status: number;
  body: Record<string, unknown>;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/** เปรียบเทียบ token แบบ constant-time (กัน timing attack) — ไม่พึ่ง node:crypto เพื่อให้ bundle ขึ้น edge ได้ */
function tokenEquals(supplied: string, expected: string): boolean {
  const encoder = new TextEncoder();
  const a = encoder.encode(supplied);
  const b = encoder.encode(expected);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a[index]! ^ b[index]!;
  }
  return diff === 0;
}

function firstNonEmptyString(
  payload: IncomingPaymentPayload,
  keys: string[]
): string | null {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function parseAmountNumber(raw: string | null): number | null {
  if (!raw) return null;
  const value = Number(raw.replace(/,/g, ""));
  if (!Number.isFinite(value) || value <= 0 || value > MAX_AMOUNT_BAHT) {
    return null;
  }
  return r2(value);
}

// "เงินเข้า 100.00 บาท" / "received 1,234.56 THB" — ยึดตัวเลขที่ตามด้วยหน่วยเงินก่อนเสมอ
const AMOUNT_WITH_UNIT = /([0-9][0-9,]*\.[0-9]{1,2})\s*(?:บาท|thb)/i;
const AMOUNT_AFTER_KEYWORD =
  /(?:เงินเข้า|รับโอน|โอนเข้า|รับเงิน|received|credited)\D{0,12}?([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i;

/** ดึงยอดเงินจาก payload — field ชัดเจนก่อน แล้วค่อย parse จากข้อความแจ้งเตือน */
export function extractAmount(payload: IncomingPaymentPayload): number | null {
  const explicit = parseAmountNumber(
    firstNonEmptyString(payload, ["amount", "amount_baht", "amountBaht", "value"])
  );
  if (explicit != null) return explicit;

  const text = firstNonEmptyString(payload, [
    "text",
    "message",
    "body",
    "title",
  ]);
  if (!text) return null;
  const withUnit = text.match(AMOUNT_WITH_UNIT);
  if (withUnit?.[1]) return parseAmountNumber(withUnit[1]);
  const afterKeyword = text.match(AMOUNT_AFTER_KEYWORD);
  if (afterKeyword?.[1]) return parseAmountNumber(afterKeyword[1]);
  return null;
}

function extractPaidAt(payload: IncomingPaymentPayload): Date | null {
  const raw = firstNonEmptyString(payload, [
    "paidAt",
    "paid_at",
    "timestamp",
    "time",
    "date",
  ]);
  if (!raw) return null;
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? null : new Date(parsed);
}

/** ref กันแจ้งซ้ำ — ใช้ id ที่แอปส่งมา ถ้าไม่มีให้ hash จากเนื้อแจ้งเตือน */
async function buildWebhookRef(
  payload: IncomingPaymentPayload,
  amount: number,
  paidAt: Date | null
): Promise<string> {
  const provided = firstNonEmptyString(payload, [
    "ref",
    "id",
    "notificationId",
    "transRef",
    "reference",
  ]);
  if (provided) {
    const clean = provided.replace(/[^A-Za-z0-9:_-]/g, "").slice(0, 48);
    if (clean) return `${WEBHOOK_REF_PREFIX}${clean}`;
  }
  const text =
    firstNonEmptyString(payload, ["text", "message", "body", "title"]) ?? "";
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(
      `${amount.toFixed(2)}|${paidAt?.toISOString() ?? ""}|${text}`
    )
  );
  const hex = Array.from(new Uint8Array(digest).slice(0, 12), byte =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  return `${WEBHOOK_REF_PREFIX}auto:${hex}`;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}

/**
 * ประมวลผลแจ้งเงินเข้า 1 ครั้ง — ตรวจ token, ดึงยอด, จับคู่ session, ปิดบิล
 * คืน HTTP status + body ให้ชั้น transport (Hono/Supabase Edge) ใช้ตอบกลับตรงๆ
 */
export async function processIncomingPayment(input: {
  branchId: number;
  token: string;
  payload: IncomingPaymentPayload;
}): Promise<IncomingPaymentResult> {
  const { branchId, token, payload } = input;
  const db = getDb();

  const expectedToken = await getStoredWebhookToken(branchId);
  if (!expectedToken) {
    return {
      status: 403,
      body: {
        ok: false,
        error:
          "ยังไม่ได้สร้าง webhook token สำหรับสาขานี้ — สร้างได้ที่ ตั้งค่าระบบ > การชำระเงิน",
      },
    };
  }
  if (!tokenEquals(token, expectedToken)) {
    return { status: 401, body: { ok: false, error: "token ไม่ถูกต้อง" } };
  }

  const amount = extractAmount(payload);
  if (amount == null) {
    return {
      status: 400,
      body: {
        ok: false,
        error:
          "อ่านยอดเงินไม่ได้ — ส่ง field \"amount\" (ตัวเลขบาท) หรือข้อความที่มียอดตามด้วย \"บาท\"",
      },
    };
  }

  const paidAt = extractPaidAt(payload);
  const webhookRef = (await buildWebhookRef(payload, amount, paidAt)).slice(
    0,
    MAX_REF_LENGTH
  );

  // แจ้งซ้ำด้วย ref เดิม → คืนบิลเดิม ไม่ปิดบิลซ้ำ (กันแอป retry/แจ้งเตือนยิงซ้ำ)
  const alreadyProcessed = await db.query.paymentSessions.findFirst({
    where: eq(paymentSessions.transRef, webhookRef),
  });
  if (alreadyProcessed) {
    const receiptNo = alreadyProcessed.saleId
      ? (
          await db.query.sales.findFirst({
            where: eq(sales.id, alreadyProcessed.saleId),
          })
        )?.receiptNo
      : undefined;
    return {
      status: 200,
      body: {
        ok: true,
        matched: true,
        duplicate: true,
        refCode: alreadyProcessed.refCode,
        receiptNo: receiptNo ?? null,
      },
    };
  }

  const now = new Date();
  const pendingSessions = await db.query.paymentSessions.findMany({
    where: and(
      eq(paymentSessions.branchId, branchId),
      eq(paymentSessions.status, "pending")
    ),
  });
  const candidates = pendingSessions.filter(
    session =>
      session.expiresAt.getTime() > now.getTime() &&
      Math.abs(r2(session.amount) - amount) < 0.005
  );

  if (candidates.length === 0) {
    console.warn("thungngern webhook: ไม่มีบิลรอชำระที่ยอดตรง", {
      branchId,
      amount,
      webhookRef,
    });
    return {
      status: 200,
      body: {
        ok: true,
        matched: false,
        reason: "no_pending_bill",
        message: `ไม่มีบิล QR ที่รอชำระยอด ${amount.toFixed(2)} บาท — ถ้าเป็นเงินของบิลในร้าน ให้แคชเชียร์สแกนสลิปหรือยืนยันเอง`,
      },
    };
  }
  if (candidates.length > 1) {
    console.warn("thungngern webhook: ยอดซ้ำหลายบิล ไม่ปิดบิลให้", {
      branchId,
      amount,
      sessions: candidates.map(session => session.refCode),
    });
    return {
      status: 200,
      body: {
        ok: true,
        matched: false,
        reason: "ambiguous_amount",
        candidates: candidates.length,
        message: `มีบิลรอชำระยอด ${amount.toFixed(2)} บาท อยู่ ${candidates.length} บิล — ระบบไม่เดาให้ กรุณาสแกนสลิปยืนยันตามปกติ`,
      },
    };
  }

  const session = candidates[0]!;
  try {
    const result = await finalizeThungngernSession(
      db,
      branchId,
      session.id,
      "webhook",
      webhookRef
    );
    if (!result.alreadyFinalized) {
      logAudit({
        action: "thungngern_webhook_confirm",
        actorId: null,
        actorName: "webhook แจ้งเงินเข้า",
        branchId,
        detail: `ยืนยันชำระอัตโนมัติจาก webhook บิล ${result.receipt.sale.receiptNo} ยอด ${result.receipt.sale.total.toFixed(2)} บาท (session ${session.refCode}, ref ${webhookRef})`,
        refType: "sale",
        refId: result.receipt.sale.id,
      });
      publishRealtimeInvalidation(branchId);
    }
    return {
      status: 200,
      body: {
        ok: true,
        matched: true,
        duplicate: result.alreadyFinalized,
        refCode: session.refCode,
        receiptNo: result.receipt.sale.receiptNo,
        amount: result.receipt.sale.total,
      },
    };
  } catch (error) {
    if (isUniqueViolation(error)) {
      // webhook อีกตัว (หรือการแจ้งซ้ำ) ปิดบิลด้วย ref เดียวกันไปแล้วพอดี
      return {
        status: 200,
        body: { ok: true, matched: true, duplicate: true, refCode: session.refCode },
      };
    }
    const message =
      error instanceof Error ? error.message : "ปิดบิลจาก webhook ไม่สำเร็จ";
    console.error("thungngern webhook: ปิดบิลไม่สำเร็จ", {
      branchId,
      sessionId: session.id,
      message,
    });
    return { status: 409, body: { ok: false, error: message } };
  }
}
