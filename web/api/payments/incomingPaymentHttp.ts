/**
 * HTTP endpoint สำหรับ webhook แจ้งเงินเข้า — ใช้ร่วมกันทั้งเซิร์ฟเวอร์ Node (boot.ts)
 * และ Supabase Edge (functions/pos-api/index.ts ผ่าน edgeRuntime export)
 *
 * POST /api/payments/incoming?branch=<branchId>
 * Authorization: Bearer <webhook token จาก ตั้งค่าระบบ > การชำระเงิน>
 * Content-Type: application/json
 * { "amount": 100.00, "text": "เงินเข้า 100.00 บาท", "ref": "id แจ้งเตือนจากแอป (ถ้ามี)" }
 *
 * ยืดหยุ่นกับแอปต่างๆ: token รับได้ทั้ง header Bearer / x-webhook-token / field token,
 * branch รับได้ทั้ง query ?branch= / field branchId, body ไม่ใช่ JSON จะถือเป็นข้อความดิบ
 */

import {
  processIncomingPayment,
  type IncomingPaymentPayload,
} from "./incomingPayment";

function jsonResponse(
  status: number,
  body: Record<string, unknown>
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function parsePositiveInt(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function tokenFromRequest(
  request: Request,
  payload: IncomingPaymentPayload
): string | null {
  const authorization = request.headers.get("authorization")?.trim();
  const bearer = authorization?.match(/^bearer\s+(.+)$/i)?.[1]?.trim();
  const headerToken = request.headers.get("x-webhook-token")?.trim();
  const payloadToken =
    typeof payload.token === "string" ? payload.token.trim() : "";
  return bearer || headerToken || payloadToken || null;
}

export async function handleIncomingPaymentRequest(
  request: Request
): Promise<Response> {
  if (request.method !== "POST") {
    return jsonResponse(405, { ok: false, error: "Method not allowed" });
  }

  const rawBody = await request.text();
  let payload: IncomingPaymentPayload;
  try {
    const parsed: unknown = rawBody ? JSON.parse(rawBody) : {};
    payload =
      typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
        ? (parsed as IncomingPaymentPayload)
        : { text: String(parsed) };
  } catch {
    // body ไม่ใช่ JSON (บางแอปส่งข้อความดิบ) — ให้ชั้นบน parse ยอดจากข้อความ
    payload = { text: rawBody };
  }

  const branchId =
    parsePositiveInt(new URL(request.url).searchParams.get("branch")) ??
    parsePositiveInt(
      typeof payload.branchId === "string" || typeof payload.branchId === "number"
        ? String(payload.branchId)
        : typeof payload.branch === "string" || typeof payload.branch === "number"
          ? String(payload.branch)
          : null
    );
  if (branchId == null) {
    return jsonResponse(400, {
      ok: false,
      error: "ระบุสาขาไม่ถูกต้อง — ใส่ ?branch=<เลขสาขา> ท้าย URL",
    });
  }

  const token = tokenFromRequest(request, payload);
  if (!token) {
    return jsonResponse(401, {
      ok: false,
      error: "ไม่พบ token — ใส่ header Authorization: Bearer <webhook token>",
    });
  }

  try {
    const result = await processIncomingPayment({ branchId, token, payload });
    return jsonResponse(result.status, result.body);
  } catch (error) {
    console.error("thungngern webhook: ประมวลผลผิดพลาด", error);
    return jsonResponse(500, {
      ok: false,
      error: "ประมวลผลแจ้งเงินเข้าไม่สำเร็จ กรุณาลองใหม่",
    });
  }
}
