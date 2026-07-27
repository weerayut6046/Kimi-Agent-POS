import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { paymentSettings } from "@db/schema";
import { setupTestDb, type TestDb } from "../test/testDb";
import { buildPromptPayPayload } from "../lib/promptpay";

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
  });
});
