import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createRouter, publicQuery } from "../middleware";
import { adminQuery } from "../guard";
import { getDb } from "../queries/connection";
import { paymentSessions, settings } from "@db/schema";
import { actorFromReq, logAudit } from "../lib/audit";
import {
  buildPromptPayPayload,
  injectAmountIntoMerchantQr,
} from "../lib/promptpay";
import { publishRealtimeInvalidation } from "../lib/realtime";
import {
  getPaymentConfigSummary,
  getThungngernRuntimeConfig,
  savePaymentConfig,
} from "../payments/paymentConfig";
import {
  buildSessionView,
  computeSaleSnapshot,
  finalizeThungngernSession,
  receiverConditionFromPromptPayId,
  startThungngernSession,
  verifySlipWithClient,
  type SlipReceiverPolicy,
} from "../payments/sessionService";
import { Slip2GoError } from "../payments/slip2go-client";

const saleInputSchema = z.object({
  shiftId: z.number().optional(),
  staffName: z.string().default(""),
  memberId: z.number().optional(),
  items: z
    .array(z.object({ productId: z.number(), qty: z.number().positive() }))
    .min(1),
  discount: z.number().nonnegative().default(0),
  pointsToRedeem: z.number().int().nonnegative().default(0),
});

async function getSettingMap(db: ReturnType<typeof getDb>, branchId: number) {
  const rows = await db
    .select()
    .from(settings)
    .where(eq(settings.branchId, branchId));
  return Object.fromEntries(rows.map(r => [r.key, r.value])) as Record<
    string,
    string
  >;
}

export const paymentsRouter = createRouter({
  // ---------- ตั้งค่า (admin) ----------
  config: adminQuery.query(async ({ ctx }) => {
    try {
      // admin เท่านั้นที่เห็น webhook token จริง (ไว้คัดลอกไปตั้งแอปแจ้งเงินเข้า)
      return await getPaymentConfigSummary(ctx.staff.branchId, {
        includeWebhookToken: true,
      });
    } catch (error) {
      console.error("Loading payment configuration failed", error);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "โหลดการตั้งค่าการชำระเงินไม่สำเร็จ กรุณาลองใหม่",
      });
    }
  }),

  updateConfig: adminQuery
    .input(
      z.object({
        thungngernEnabled: z.boolean(),
        promptpayId: z.string().trim().max(20),
        qrMode: z.enum(["promptpay", "merchant"]).optional(),
        merchantPayload: z.string().trim().max(512).optional(),
        apiSecret: z.string().trim().min(1).max(255).optional(),
        clearApiSecret: z.boolean().optional(),
        regenerateWebhookToken: z.boolean().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      let config;
      try {
        config = await savePaymentConfig({
          branchId: ctx.staff.branchId,
          ...input,
        });
      } catch (error) {
        // payload merchant ไม่ผ่านการ validate ฯลฯ — ส่งข้อความไทยจาก service ตรงๆ
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error
              ? error.message
              : "บันทึกการตั้งค่าการชำระเงินไม่สำเร็จ",
        });
      }
      logAudit({
        action: "update_payment_settings",
        ...actorFromReq(ctx.req),
        detail: [
          `QR ถุงเงิน: ${input.thungngernEnabled ? "เปิด" : "ปิด"}`,
          `โหมด QR: ${input.qrMode === "merchant" ? "QR ร้านค้าถุงเงิน" : "พร้อมเพย์"}`,
          `PromptPay ID: ${input.promptpayId ? "ตั้งค่า" : "ว่าง"}`,
          input.merchantPayload ? "เปลี่ยน QR ร้านค้าถุงเงิน" : null,
          input.apiSecret
            ? "เปลี่ยน Slip2Go API Secret"
            : input.clearApiSecret
              ? "ลบ Slip2Go API Secret"
              : "ไม่ได้เปลี่ยน Slip2Go API Secret",
          input.regenerateWebhookToken ? "สร้าง webhook token ใหม่" : null,
        ]
          .filter(Boolean)
          .join(", "),
        refType: "payment_settings",
      });
      return { ok: true, config };
    }),

  // ทดสอบการเชื่อมต่อ Slip2Go — ยืนยัน secret ถูกต้องและดูโควตาตรวจสลิปคงเหลือ
  testConnection: adminQuery.mutation(async ({ ctx }) => {
    const branchId = ctx.staff.branchId;
    const runtime = await getThungngernRuntimeConfig(branchId);
    if (!runtime) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "ยังตั้งค่าไม่ครบ — กรุณาเปิดใช้งาน ระบุ PromptPay ID และ Slip2Go API Secret ก่อนทดสอบ",
      });
    }
    try {
      const info = await runtime.client.getAccountInfo();
      return {
        ok: true,
        mockMode: runtime.mockMode,
        shopName: info.shopName,
        packageName: info.packageName,
        packageExpiredDate: info.packageExpiredDate,
        tokenRemaining: info.tokenRemaining,
        estimatedQuotaSlip: info.estimatedQuotaSlip,
      };
    } catch (error) {
      if (error instanceof Slip2GoError) {
        throw new TRPCError({ code: "BAD_GATEWAY", message: error.message });
      }
      throw error;
    }
  }),

  // ---------- ใช้งานหน้าร้าน (cashier) ----------
  /** สถานะเปิดใช้งานสำหรับ POS — ไม่มี secret */
  thungngernStatus: publicQuery.query(async ({ ctx }) => {
    const summary = await getPaymentConfigSummary(ctx.staff.branchId);
    const qrReady =
      summary.qrMode === "merchant"
        ? summary.merchant != null
        : summary.promptpayId.length > 0;
    return { enabled: summary.thungngernEnabled && qrReady };
  }),

  /**
   * QR พร้อมเพย์ทั่วไป (ไม่ผ่าน session ถุงเงิน) — payload ล็อกยอดตามบิล
   * ใช้ PromptPay ID จากตั้งค่า; คืน payload: null ถ้ายังไม่ได้ตั้งค่า
   */
  promptpayQr: publicQuery
    .input(z.object({ amount: z.number().positive().max(999_999_999) }))
    .query(async ({ input, ctx }) => {
      const summary = await getPaymentConfigSummary(ctx.staff.branchId);
      if (!summary.promptpayId) return { payload: null as string | null };
      return {
        payload: buildPromptPayPayload({
          promptPayId: summary.promptpayId,
          amount: Math.round(input.amount * 100) / 100,
        }),
      };
    }),

  /** สร้าง session รอชำระ + QR payload ที่ล็อกยอด (promptpay หรือ merchant ตามการตั้งค่า) */
  startThungngern: publicQuery
    .input(saleInputSchema)
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const branchId = ctx.staff.branchId;
      const summary = await getPaymentConfigSummary(branchId);
      if (!summary.thungngernEnabled) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "ยังไม่ได้เปิดใช้งาน QR ถุงเงิน กรุณาให้ผู้ดูแลตั้งค่าที่ ตั้งค่าระบบ > การชำระเงิน",
        });
      }
      try {
        const snapshot = await computeSaleSnapshot(
          db,
          branchId,
          input,
          await getSettingMap(db, branchId)
        );
        if (snapshot.total <= 0) {
          throw new Error("ยอดสุทธิต้องมากกว่า 0 สำหรับ QR ถุงเงิน");
        }
        // ตรวจความพร้อมของ QR ก่อนสร้าง session เพื่อไม่ให้เสีย session เปล่า
        let payload: string;
        if (summary.qrMode === "merchant") {
          if (!summary.merchantPayload) {
            throw new Error(
              "ยังไม่ได้ตั้ง QR ร้านค้าถุงเงิน กรุณาให้ผู้ดูแลวาง payload ที่ ตั้งค่าระบบ > การชำระเงิน"
            );
          }
          payload = injectAmountIntoMerchantQr(
            summary.merchantPayload,
            snapshot.total
          );
        } else {
          if (!summary.promptpayId) {
            throw new Error(
              "ยังไม่ได้ตั้ง PromptPay ID กรุณาให้ผู้ดูแลตั้งค่าที่ ตั้งค่าระบบ > การชำระเงิน"
            );
          }
          payload = buildPromptPayPayload({
            promptPayId: summary.promptpayId,
            amount: snapshot.total,
          });
        }
        const session = await startThungngernSession(db, branchId, snapshot);
        return {
          sessionId: session.id,
          refCode: session.refCode,
          payload,
          amount: session.amount,
          expiresAt: session.expiresAt,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error ? error.message : "สร้าง QR ถุงเงินไม่สำเร็จ",
        });
      }
    }),

  /**
   * อ่านสถานะ session อย่างเดียว (หน้าจอ poll ทุก 3 วินาที) —
   * ไม่เรียก provider จากที่นี่: การปิดบิลอัตโนมัติเกิดจากการสแกนสลิป (verifySlip)
   * หรือปุ่มยืนยันเองเท่านั้น
   */
  sessionStatus: publicQuery
    .input(z.object({ sessionId: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const branchId = ctx.staff.branchId;
      let session = await db.query.paymentSessions.findFirst({
        where: and(
          eq(paymentSessions.id, input.sessionId),
          eq(paymentSessions.branchId, branchId)
        ),
      });
      if (!session) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "ไม่พบ session การชำระเงิน",
        });
      }
      // หมดเวลาแล้วแต่ยังค้าง pending — ปิดสถานะให้ตรงความจริง
      if (
        session.status === "pending" &&
        Date.now() >= session.expiresAt.getTime()
      ) {
        await db
          .update(paymentSessions)
          .set({ status: "expired" })
          .where(
            and(
              eq(paymentSessions.id, session.id),
              eq(paymentSessions.status, "pending")
            )
          );
        session = { ...session, status: "expired" };
      }
      return { view: buildSessionView(session), receipt: null };
    }),

  /**
   * แคชเชียร์สแกน QR บนสลิปของลูกค้า → ตรวจกับ Slip2Go → ปิดบิลอัตโนมัติ
   * ผ่านเฉพาะสลิปจริง ไม่ซ้ำ ผู้รับคือบัญชีร้าน ยอดตรงเป๊ะ และอยู่ในช่วงเวลาบิล
   */
  verifySlip: publicQuery
    .input(
      z.object({
        sessionId: z.number().int().positive(),
        qrCode: z.string().trim().min(10).max(512),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const branchId = ctx.staff.branchId;
      const runtime = await getThungngernRuntimeConfig(branchId);
      if (!runtime) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "ยังตั้งค่าการตรวจสลิปไม่ครบ — กรุณาให้ผู้ดูแลระบบตั้ง Slip2Go API Secret ที่ ตั้งค่าระบบ > การชำระเงิน",
        });
      }
      try {
        // โหมด merchant (QR ร้านค้าถุงเงิน): Slip2Go ไม่มี accountType สำหรับ biller QR
        // จึงไม่ส่ง checkReceiver — ตรวจผู้รับเองจากผลสลิปเทียบ ref1/billerId ของร้าน
        const receiverPolicy: SlipReceiverPolicy =
          runtime.qrMode === "merchant" && runtime.merchant
            ? {
                kind: "local",
                acceptedAccounts: [
                  runtime.merchant.ref1,
                  runtime.merchant.billerId,
                ],
              }
            : {
                kind: "slip2go",
                conditions: [
                  receiverConditionFromPromptPayId(runtime.promptpayId),
                ],
              };
        const result = await verifySlipWithClient(
          db,
          branchId,
          input.sessionId,
          receiverPolicy,
          runtime.client,
          input.qrCode
        );
        if (!result.alreadyFinalized) {
          logAudit({
            action: "thungngern_slip_verify",
            ...actorFromReq(ctx.req),
            detail: `ยืนยันชำระผ่านสลิป Slip2Go บิล ${result.receipt.sale.receiptNo} ยอด ${result.receipt.sale.total.toFixed(2)} บาท transRef ${result.slip.transRef}`,
            refType: "sale",
            refId: result.receipt.sale.id,
          });
          publishRealtimeInvalidation(branchId);
        }
        return { receipt: result.receipt, slip: result.slip };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error ? error.message : "ตรวจสลิปไม่สำเร็จ",
        });
      }
    }),

  /** แคชเชียร์ยืนยันรับเงินเอง (เหมือนพฤติกรรม QR เดิม) — ปิดบิลทันทีแบบ idempotent */
  manualConfirm: publicQuery
    .input(z.object({ sessionId: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const branchId = ctx.staff.branchId;
      const result = await finalizeThungngernSession(
        db,
        branchId,
        input.sessionId,
        "manual"
      );
      if (!result.alreadyFinalized) {
        logAudit({
          action: "thungngern_manual_confirm",
          ...actorFromReq(ctx.req),
          detail: `ยืนยันรับเงิน QR ถุงเงินด้วยตนเอง บิล ${result.receipt.sale.receiptNo} ยอด ${result.receipt.sale.total.toFixed(2)} บาท`,
          refType: "sale",
          refId: result.receipt.sale.id,
        });
      }
      return { receipt: result.receipt };
    }),

  cancelSession: publicQuery
    .input(z.object({ sessionId: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const branchId = ctx.staff.branchId;
      const updated = await db
        .update(paymentSessions)
        .set({ status: "cancelled" })
        .where(
          and(
            eq(paymentSessions.id, input.sessionId),
            eq(paymentSessions.branchId, branchId),
            eq(paymentSessions.status, "pending")
          )
        )
        .returning({ id: paymentSessions.id });
      const session = await db.query.paymentSessions.findFirst({
        where: and(
          eq(paymentSessions.id, input.sessionId),
          eq(paymentSessions.branchId, branchId)
        ),
      });
      if (!session) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "ไม่พบ session การชำระเงิน",
        });
      }
      if (!updated[0] && session.status === "confirmed") {
        throw new TRPCError({
          code: "CONFLICT",
          message: "ชำระเงินสำเร็จแล้ว ยกเลิกไม่ได้",
        });
      }
      return { ok: true };
    }),
});
