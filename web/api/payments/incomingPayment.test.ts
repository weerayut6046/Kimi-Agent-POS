import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { paymentSessions, products, sales } from "@db/schema";
import { setupTestDb, type TestDb } from "../test/testDb";
import {
  computeSaleSnapshot,
  startThungngernSession,
} from "./sessionService";

/**
 * incomingPayment ดึง env (APP_SECRET) ผ่าน paymentConfig ตอนโหลดโมดูล
 * จึงต้อง dynamic import หลัง setupTestDb() ตั้งค่า env แล้วเท่านั้น
 */
let t: TestDb;
let webhookToken: string;
let processIncomingPayment: typeof import("./incomingPayment").processIncomingPayment;
let extractAmount: typeof import("./incomingPayment").extractAmount;
let handleIncomingPaymentRequest: typeof import("./incomingPaymentHttp").handleIncomingPaymentRequest;

beforeAll(async () => {
  t = await setupTestDb();
  ({ processIncomingPayment, extractAmount } = await import(
    "./incomingPayment"
  ));
  ({ handleIncomingPaymentRequest } = await import("./incomingPaymentHttp"));
  const { savePaymentConfig } = await import("./paymentConfig");
  const config = await savePaymentConfig({
    branchId: 1,
    thungngernEnabled: true,
    promptpayId: "0812345678",
    regenerateWebhookToken: true,
  });
  if (!config.webhookToken) throw new Error("สร้าง webhook token ไม่สำเร็จ");
  webhookToken = config.webhookToken;
});

afterAll(() => t.cleanup());

const water = async () => {
  const p = await t.db.query.products.findFirst({
    where: and(eq(products.code, "WATER"), eq(products.branchId, 1)),
  });
  if (!p) throw new Error("ไม่พบสินค้า WATER ใน seed");
  return p;
};

/** สร้าง session รอชำระ — น้ำราคาหน่วยละ 10 บาท จึงล็อกยอดด้วย qty */
const makeSession = async (qty: number) => {
  const p = await water();
  const snapshot = await computeSaleSnapshot(
    t.db,
    1,
    {
      staffName: "ทดสอบ",
      items: [{ productId: p.id, qty }],
      discount: 0,
      pointsToRedeem: 0,
    },
    {}
  );
  return startThungngernSession(t.db, 1, snapshot);
};

const saleCount = async () =>
  (await t.db.select().from(sales).where(eq(sales.branchId, 1))).length;

const storedSession = (id: number) =>
  t.db.query.paymentSessions.findFirst({
    where: eq(paymentSessions.id, id),
  });

describe("extractAmount — ดึงยอดเงินจาก payload ของแอปแจ้งเตือน", () => {
  it("อ่านจาก field amount ได้ทั้งตัวเลขและสตริงมีคอมมา", () => {
    expect(extractAmount({ amount: 100 })).toBe(100);
    expect(extractAmount({ amount: "1,234.56" })).toBe(1234.56);
    expect(extractAmount({ amount_baht: "250.00" })).toBe(250);
  });

  it("อ่านจากข้อความแจ้งเตือนที่มียอดตามด้วย 'บาท'", () => {
    expect(
      extractAmount({ text: "KTB NEXT: เงินเข้า 1,500.00 บาท จาก พร้อมเพย์" })
    ).toBe(1500);
    expect(extractAmount({ message: "received 99.50 THB" })).toBe(99.5);
  });

  it("คืน null เมื่อไม่มียอดเงินหรือยอดไม่ถูกต้อง", () => {
    expect(extractAmount({ text: "แจ้งเตือนทั่วไป" })).toBeNull();
    expect(extractAmount({ amount: -5 })).toBeNull();
    expect(extractAmount({})).toBeNull();
  });
});

describe("processIncomingPayment — จับคู่ยอดเงินเข้ากับบิลที่รอชำระ", () => {
  it("ปฏิเสธเมื่อ token ไม่ถูกต้อง (401)", async () => {
    const result = await processIncomingPayment({
      branchId: 1,
      token: "token-ผิด",
      payload: { amount: 20 },
    });
    expect(result.status).toBe(401);
  });

  it("ปิดบิลอัตโนมัติเมื่อยอดตรง 1 บิล — confirmedBy = webhook", async () => {
    const session = await makeSession(2); // 20 บาท
    const before = await saleCount();

    const result = await processIncomingPayment({
      branchId: 1,
      token: webhookToken,
      payload: { amount: 20, ref: "notif-auto-1" },
    });

    expect(result.status).toBe(200);
    expect(result.body.matched).toBe(true);
    expect(result.body.duplicate).toBe(false);
    expect(result.body.refCode).toBe(session.refCode);
    expect(typeof result.body.receiptNo).toBe("string");
    expect(await saleCount()).toBe(before + 1);

    const stored = await storedSession(session.id);
    expect(stored?.status).toBe("confirmed");
    expect(stored?.confirmedBy).toBe("webhook");
    expect(stored?.transRef).toBe("wh:notif-auto-1");
    expect(stored?.saleId).not.toBeNull();
  });

  it("แจ้งซ้ำด้วย ref เดิม → duplicate:true ไม่สร้างบิลเพิ่ม (idempotent)", async () => {
    await makeSession(3); // 30 บาท
    const before = await saleCount();
    const call = () =>
      processIncomingPayment({
        branchId: 1,
        token: webhookToken,
        payload: { amount: 30, ref: "notif-dup-1" },
      });

    const first = await call();
    const second = await call();

    expect(first.body.matched).toBe(true);
    expect(second.body.matched).toBe(true);
    expect(second.body.duplicate).toBe(true);
    expect(await saleCount()).toBe(before + 1);
  });

  it("ไม่มีบิลรอชำระยอดนั้น → matched:false (no_pending_bill) ไม่สร้างบิล", async () => {
    const before = await saleCount();
    const result = await processIncomingPayment({
      branchId: 1,
      token: webhookToken,
      payload: { amount: 987.65, ref: "notif-none-1" },
    });
    expect(result.status).toBe(200);
    expect(result.body.matched).toBe(false);
    expect(result.body.reason).toBe("no_pending_bill");
    expect(await saleCount()).toBe(before);
  });

  it("ยอดเดียวกันค้าง 2 บิล → ambiguous ไม่ปิดบิลใดๆ", async () => {
    const a = await makeSession(4); // 40 บาท
    const b = await makeSession(4);
    const before = await saleCount();

    const result = await processIncomingPayment({
      branchId: 1,
      token: webhookToken,
      payload: { amount: 40, ref: "notif-ambig-1" },
    });

    expect(result.body.matched).toBe(false);
    expect(result.body.reason).toBe("ambiguous_amount");
    expect(result.body.candidates).toBe(2);
    expect((await storedSession(a.id))?.status).toBe("pending");
    expect((await storedSession(b.id))?.status).toBe("pending");
    expect(await saleCount()).toBe(before);
  });

  it("session หมดเวลาแล้วไม่ถูกปิด แม้ยอดจะตรง", async () => {
    const session = await makeSession(5); // 50 บาท
    await t.db
      .update(paymentSessions)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(paymentSessions.id, session.id));
    const before = await saleCount();

    const result = await processIncomingPayment({
      branchId: 1,
      token: webhookToken,
      payload: { amount: 50, ref: "notif-exp-1" },
    });

    expect(result.body.matched).toBe(false);
    expect((await storedSession(session.id))?.status).toBe("pending");
    expect(await saleCount()).toBe(before);
  });

  it("จับคู่ได้จากข้อความแจ้งเตือนดิบ (ไม่มี field amount)", async () => {
    const session = await makeSession(6); // 60 บาท
    const result = await processIncomingPayment({
      branchId: 1,
      token: webhookToken,
      payload: { text: "เงินเข้า 60.00 บาท จาก K PLUS", ref: "notif-text-1" },
    });
    expect(result.body.matched).toBe(true);
    expect(result.body.refCode).toBe(session.refCode);
  });
});

describe("handleIncomingPaymentRequest — HTTP shim", () => {
  it("รับ POST เท่านั้น", async () => {
    const response = await handleIncomingPaymentRequest(
      new Request("http://test.local/api/payments/incoming?branch=1", {
        method: "GET",
      })
    );
    expect(response.status).toBe(405);
  });

  it("บังคับระบุ branch และ token", async () => {
    const noBranch = await handleIncomingPaymentRequest(
      new Request("http://test.local/api/payments/incoming", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amount: 10 }),
      })
    );
    expect(noBranch.status).toBe(400);

    const noToken = await handleIncomingPaymentRequest(
      new Request("http://test.local/api/payments/incoming?branch=1", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amount: 10 }),
      })
    );
    expect(noToken.status).toBe(401);
  });

  it("ปิดบิลผ่าน HTTP จริง: token ใน Bearer header + branch ใน query", async () => {
    const session = await makeSession(7); // 70 บาท
    const response = await handleIncomingPaymentRequest(
      new Request("http://test.local/api/payments/incoming?branch=1", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${webhookToken}`,
        },
        body: JSON.stringify({
          amount: 70,
          text: "เงินเข้า 70.00 บาท",
          ref: "notif-http-1",
        }),
      })
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.matched).toBe(true);
    expect(body.refCode).toBe(session.refCode);
    expect((await storedSession(session.id))?.confirmedBy).toBe("webhook");
  });
});
