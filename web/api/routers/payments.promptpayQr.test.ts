import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { paymentSettings } from "@db/schema";
import { setupTestDb, type TestDb } from "../test/testDb";
import {
  buildPromptPayPayload,
  injectAmountIntoMerchantQr,
} from "../lib/promptpay";

const OFFICIAL_MERCHANT_QR =
  "00020101021130830016A0000006770101120115010753700088205021922141170560220009090317WEERAYUTNAMWONGSA53037645802TH62080704000063046EAD";

let t: TestDb;

beforeAll(async () => {
  t = await setupTestDb();
});
afterAll(() => t.cleanup());

describe("payments.promptpayQr", () => {
  it("คืน payload: null เมื่อยังไม่ได้ตั้งค่า PromptPay ID", async () => {
    await t.db
      .delete(paymentSettings)
      .where(eq(paymentSettings.branchId, 1));

    const result = await t
      .caller("cashier")
      .payments.promptpayQr({ amount: 20 });

    expect(result.payload).toBeNull();
    expect(result.mode).toBe("promptpay");
  });

  it("คืน payload ที่ล็อกยอดตาม PromptPay ID ในตั้งค่า", async () => {
    await t.db
      .insert(paymentSettings)
      .values({
        branchId: 1,
        thungngernEnabled: false,
        promptpayId: "0812345678",
      })
      .onConflictDoNothing();

    const result = await t
      .caller("cashier")
      .payments.promptpayQr({ amount: 20 });

    expect(result.payload).toBe(
      buildPromptPayPayload({ promptPayId: "0812345678", amount: 20 })
    );
    expect(result.mode).toBe("promptpay");
  });

  it("รองรับ QR ร้านค้าของ production และฉีดยอดลง payload", async () => {
    await t.db
      .insert(paymentSettings)
      .values({
        branchId: 1,
        thungngernEnabled: true,
        qrMode: "merchant",
        promptpayId: "",
        merchantPayload: OFFICIAL_MERCHANT_QR,
      })
      .onConflictDoUpdate({
        target: paymentSettings.branchId,
        set: {
          qrMode: "merchant",
          promptpayId: "",
          merchantPayload: OFFICIAL_MERCHANT_QR,
        },
      });

    const result = await t
      .caller("cashier")
      .payments.promptpayQr({ amount: 407.4 });

    expect(result.payload).toBe(
      injectAmountIntoMerchantQr(OFFICIAL_MERCHANT_QR, 407.4)
    );
    expect(result.mode).toBe("merchant");
  });
});

describe("payments.validateMerchantQr", () => {
  it("ตรวจ QR ร้านค้าจากรูปที่ client อ่านมาและคืนข้อมูลร้าน", async () => {
    const result = await t
      .caller("admin")
      .payments.validateMerchantQr({ payload: OFFICIAL_MERCHANT_QR });

    expect(result).toEqual({
      billerId: "010753700088205",
      ref1: "2214117056022000909",
      ref2: "WEERAYUTNAMWONGSA",
    });
  });

  it("ปฏิเสธ QR ทั่วไปที่ไม่ใช่ร้านค้าถุงเงิน", async () => {
    await expect(
      t.caller("admin").payments.validateMerchantQr({
        payload: buildPromptPayPayload({
          promptPayId: "0812345678",
          amount: 20,
        }),
      })
    ).rejects.toThrow("ไม่ใช่ QR ร้านค้า");
  });
});
