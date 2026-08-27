import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  members,
  paymentSettings,
  paymentSessions,
  products,
  sales,
} from "@db/schema";
import { setupTestDb, type TestDb } from "../test/testDb";
import { crc16Ccitt } from "../lib/promptpay";
import {
  computeSaleSnapshot,
  finalizeThungngernSession,
  receiverConditionFromPromptPayId,
  startThungngernSession,
  verifySlipWithClient,
  type SlipReceiverPolicy,
} from "./sessionService";
import { createMockSlip2GoClient, Slip2GoError } from "./slip2go-client";
import { bangkokDateKey } from "@contracts/promotion";

const PROMPTPAY_POLICY: SlipReceiverPolicy = {
  kind: "slip2go",
  conditions: [{ accountType: "02001", accountNumber: "0812345678" }],
};

/** นโยบายโหมด merchant — ยอมรับเฉพาะสลิปที่โอนเข้า ref1/billerId ของร้าน */
const MERCHANT_POLICY: SlipReceiverPolicy = {
  kind: "local",
  acceptedAccounts: ["2214117056022000909", "010753700088205"],
};

const OFFICIAL_MERCHANT_QR =
  "00020101021130830016A0000006770101120115010753700088205021922141170560220009090317WEERAYUTNAMWONGSA53037645802TH62080704000063046EAD";

let t: TestDb;
const NO_PROMOTION = {
  promotion_per_liter_feature_enabled: "0",
  promotion_enabled: "0",
  bill_promotion_enabled: "0",
};

beforeAll(async () => {
  t = await setupTestDb();
  await t.db
    .insert(paymentSettings)
    .values({
      branchId: 1,
      thungngernEnabled: true,
      promptpayId: "0812345678",
    })
    .onConflictDoNothing();
});
afterAll(() => t.cleanup());

const water = async () => {
  const p = await t.db.query.products.findFirst({
    where: and(eq(products.code, "WATER"), eq(products.branchId, 1)),
  });
  if (!p) throw new Error("ไม่พบสินค้า WATER ใน seed");
  return p;
};

const fuel = async () => {
  const p = await t.db.query.products.findFirst({
    where: and(eq(products.code, "GSH95"), eq(products.branchId, 1)),
  });
  if (!p) throw new Error("ไม่พบสินค้า GSH95 ใน seed");
  return p;
};

const makeSession = async (qty = 2) => {
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
    NO_PROMOTION
  );
  return startThungngernSession(t.db, 1, snapshot);
};

const saleCount = async () =>
  (await t.db.select().from(sales).where(eq(sales.branchId, 1))).length;

const storedSession = (id: number) =>
  t.db.query.paymentSessions.findFirst({ where: eq(paymentSessions.id, id) });

const slipOf = (overrides: Record<string, unknown> = {}) => ({
  referenceId: "REF-1",
  transRef: "SLIP-TX-1",
  dateTime: new Date().toISOString(),
  amount: 20,
  senderName: "ลูกค้าทดสอบ",
  receiverProxyType: null,
  receiverProxyAccount: null,
  receiverBankAccount: null,
  raw: null,
  ...overrides,
});

describe("computeSaleSnapshot — แต้มสมาชิก", () => {
  it("ทุก 100 บาทได้ 1 แต้ม และ 1 แต้มลดท้ายบิลได้ 1 บาท", async () => {
    const product = await water();
    const member = await t.db.query.members.findFirst();
    if (!member) throw new Error("ไม่พบสมาชิกใน seed");

    const snapshot = await computeSaleSnapshot(
      t.db,
      1,
      {
        staffName: "ทดสอบแต้ม",
        memberId: member.id,
        items: [{ productId: product.id, qty: 15 }],
        discount: 0,
        pointsToRedeem: 50,
        loyaltyChoice: "redeem",
      },
      NO_PROMOTION
    );

    expect(snapshot.subtotal).toBe(150);
    expect(snapshot.discount).toBe(50);
    expect(snapshot.total).toBe(100);
    expect(snapshot.pointsToRedeem).toBe(50);
    expect(snapshot.pointsEarned).toBe(0);
  });

  it("ช่วงโปรโมชั่นล็อกยอด QR ด้วยส่วนลดโปรโมชั่นเท่านั้นและไม่ให้แต้ม", async () => {
    const product = await fuel();
    const member = await t.db.query.members.findFirst();
    if (!member) throw new Error("ไม่พบสมาชิกใน seed");
    const today = bangkokDateKey(new Date());
    const promotionSettings = {
      promotion_per_liter_feature_enabled: "1",
      promotion_enabled: "1",
      bill_promotion_enabled: "0",
      promotion_name: "โปรโมชั่นทดสอบ",
      promotion_discount: "0.50",
      promotion_start_date: today,
      promotion_end_date: today,
    };

    const snapshot = await computeSaleSnapshot(
      t.db,
      1,
      {
        staffName: "ทดสอบโปรโมชั่น",
        memberId: member.id,
        items: [{ productId: product.id, qty: 10 }],
        discount: 100,
        pointsToRedeem: 0,
        loyaltyChoice: "earn",
      },
      promotionSettings
    );

    expect(snapshot.subtotal).toBe(407.4);
    expect(snapshot.discount).toBe(5);
    expect(snapshot.total).toBe(402.4);
    expect(snapshot.pointsEarned).toBe(0);
    expect(snapshot.pointsToRedeem).toBe(0);

    await expect(
      computeSaleSnapshot(
        t.db,
        1,
        {
          staffName: "ทดสอบใช้แต้มช่วงโปรโมชั่น",
          memberId: member.id,
          items: [{ productId: product.id, qty: 1 }],
          discount: 0,
          pointsToRedeem: 1,
          loyaltyChoice: "redeem",
        },
        promotionSettings
      )
    ).rejects.toThrow("ช่วงโปรโมชั่นไม่สามารถใช้แต้ม");
  });

  it("ล็อกยอด QR ตามโปรโมชั่นเติมถึงเกณฑ์แล้วลดคงที่", async () => {
    const product = await fuel();
    const member = await t.db.query.members.findFirst();
    if (!member) throw new Error("ไม่พบสมาชิกใน seed");
    const today = bangkokDateKey(new Date());
    const promotionSettings = {
      promotion_per_liter_feature_enabled: "0",
      promotion_enabled: "0",
      bill_promotion_enabled: "1",
      bill_promotion_name: "เติมครบ 1,000 ลด 20",
      bill_promotion_min_fuel_spend: "1000",
      bill_promotion_discount: "20",
      bill_promotion_start_date: today,
      bill_promotion_end_date: today,
    };

    const snapshot = await computeSaleSnapshot(
      t.db,
      1,
      {
        staffName: "ทดสอบโปรโมชั่นตามยอด",
        memberId: member.id,
        items: [{ productId: product.id, qty: 1000 / product.price }],
        discount: 100,
        pointsToRedeem: 0,
        loyaltyChoice: "earn",
      },
      promotionSettings
    );

    expect(snapshot.subtotal).toBe(1000);
    expect(snapshot.discount).toBe(20);
    expect(snapshot.total).toBe(980);
    expect(snapshot.pointsEarned).toBe(0);
  });

  it("ตรวจยอดแต้มกลางอีกครั้งตอนปิดบิลเพื่อกันสองสาขาใช้แต้มพร้อมกัน", async () => {
    const product = await water();
    const member = await t.db.query.members.findFirst();
    if (!member) throw new Error("ไม่พบสมาชิกใน seed");
    const originalPoints = member.points;
    const snapshot = await computeSaleSnapshot(
      t.db,
      1,
      {
        staffName: "ทดสอบแต้มพร้อมกัน",
        memberId: member.id,
        items: [{ productId: product.id, qty: 10 }],
        discount: 0,
        pointsToRedeem: 10,
      },
      NO_PROMOTION
    );
    const session = await startThungngernSession(t.db, 1, snapshot);

    try {
      await t.db
        .update(members)
        .set({ points: 0 })
        .where(eq(members.id, member.id));
      await expect(
        finalizeThungngernSession(t.db, 1, session.id, "manual")
      ).rejects.toThrow("แต้มไม่พอ");
      expect((await storedSession(session.id))?.status).toBe("pending");
    } finally {
      await t.db
        .update(members)
        .set({ points: originalPoints })
        .where(eq(members.id, member.id));
    }
  });

  it("ไม่สร้าง snapshot ให้บัตรที่หมดอายุและตัดยอดแต้มเดิมเป็นศูนย์", async () => {
    const product = await water();
    const [expiredMember] = await t.db
      .insert(members)
      .values({
        memberCode: "M-EXPIRED-TNG",
        name: "สมาชิกหมดอายุถุงเงิน",
        phone: "0800000299",
        points: 40,
        cardActivatedAt: new Date("2025-01-01T00:00:00.000Z"),
        cardExpiresAt: new Date("2026-01-01T00:00:00.000Z"),
      })
      .returning();

    await expect(
      computeSaleSnapshot(
        t.db,
        1,
        {
          staffName: "ทดสอบบัตรหมดอายุ",
          memberId: expiredMember!.id,
          items: [{ productId: product.id, qty: 10 }],
          discount: 0,
          pointsToRedeem: 0,
        },
        NO_PROMOTION
      )
    ).rejects.toThrow("บัตรสมาชิกหมดอายุแล้ว");

    const reloaded = await t.db.query.members.findFirst({
      where: eq(members.id, expiredMember!.id),
    });
    expect(reloaded?.points).toBe(0);
  });
});

describe("finalizeThungngernSession — idempotency", () => {
  it("ไม่สร้าง session เมื่อสินค้าหมด และไม่ปิดบิลหากสต๊อกหมดภายหลัง", async () => {
    const [product] = await t.db
      .insert(products)
      .values({
        branchId: 1,
        code: "TNG-STOCK-TEST",
        name: "สินค้าถุงเงินทดสอบ",
        category: "other",
        unit: "ชิ้น",
        price: 50,
        cost: 20,
        stockQty: 1,
        lowStockAt: 1,
      })
      .returning();

    await t.db
      .update(products)
      .set({ stockQty: 0 })
      .where(eq(products.id, product!.id));
    await expect(
      computeSaleSnapshot(
        t.db,
        1,
        {
          staffName: "ทดสอบ",
          items: [{ productId: product!.id, qty: 1 }],
          discount: 0,
          pointsToRedeem: 0,
        },
        NO_PROMOTION
      )
    ).rejects.toThrow("หมดแล้ว ไม่สามารถขายได้");

    await t.db
      .update(products)
      .set({ stockQty: 1 })
      .where(eq(products.id, product!.id));
    const snapshot = await computeSaleSnapshot(
      t.db,
      1,
      {
        staffName: "ทดสอบ",
        items: [{ productId: product!.id, qty: 1 }],
        discount: 0,
        pointsToRedeem: 0,
      },
      NO_PROMOTION
    );
    const session = await startThungngernSession(t.db, 1, snapshot);
    await t.db
      .update(products)
      .set({ stockQty: 0 })
      .where(eq(products.id, product!.id));

    await expect(
      finalizeThungngernSession(t.db, 1, session.id, "manual")
    ).rejects.toThrow("หมดแล้ว ไม่สามารถขายได้");
    expect((await storedSession(session.id))?.status).toBe("pending");
  });

  it("ปิด session และสร้างบิล QR ถุงเงินครั้งเดียว แม้ถูกเรียกซ้ำ (สลิป/ปุ่มยืนยันเองพร้อมกัน)", async () => {
    const session = await makeSession();
    const before = await saleCount();

    const first = await finalizeThungngernSession(
      t.db,
      1,
      session.id,
      "auto",
      "TX-1"
    );
    expect(first.alreadyFinalized).toBe(false);
    expect(first.receipt.sale.paymentMethod).toBe("thungngern");
    expect(first.receipt.sale.total).toBe(session.amount);
    expect(first.receipt.sale.received).toBe(session.amount);
    expect(first.receipt.sale.changeAmt).toBe(0);
    expect(first.receipt.items).toHaveLength(1);

    // เรียกซ้ำ — ต้องคืนบิลเดิม ไม่สร้างบิลใหม่
    const second = await finalizeThungngernSession(
      t.db,
      1,
      session.id,
      "manual"
    );
    expect(second.alreadyFinalized).toBe(true);
    expect(second.receipt.sale.id).toBe(first.receipt.sale.id);
    expect(second.receipt.sale.receiptNo).toBe(first.receipt.sale.receiptNo);
    expect(await saleCount()).toBe(before + 1);

    const stored = await storedSession(session.id);
    expect(stored?.status).toBe("confirmed");
    expect(stored?.confirmedBy).toBe("auto"); // ผู้ปิดครั้งแรกชนะ
    expect(stored?.externalRef).toBe("TX-1");
    expect(stored?.transRef).toBe("TX-1"); // externalRef คือ transRef ของธนาคาร
    expect(stored?.saleId).toBe(first.receipt.sale.id);
  });

  it("session ที่ถูกยกเลิกแล้ว finalize ไม่ได้", async () => {
    const session = await makeSession();
    await t.db
      .update(paymentSessions)
      .set({ status: "cancelled" })
      .where(eq(paymentSessions.id, session.id));
    await expect(
      finalizeThungngernSession(t.db, 1, session.id, "manual")
    ).rejects.toThrow("ถูกยกเลิก");
  });
});

describe("receiverConditionFromPromptPayId", () => {
  it("เบอร์โทร 10 หลัก → 02001, เลข 13 หลัก → 02003", () => {
    expect(receiverConditionFromPromptPayId("081-234-5678")).toEqual({
      accountType: "02001",
      accountNumber: "0812345678",
    });
    expect(receiverConditionFromPromptPayId("1234567890123")).toEqual({
      accountType: "02003",
      accountNumber: "1234567890123",
    });
    expect(() => receiverConditionFromPromptPayId("12345")).toThrow();
  });
});

describe("verifySlipWithClient — สแกนสลิปยืนยันบิล", () => {
  it("สลิปผ่านทุกเงื่อนไข → ปิดบิลพร้อม transRef และเรียกซ้ำได้ idempotent", async () => {
    const session = await makeSession(2); // 20฿
    const before = await saleCount();
    const { client, calls, getLastVerifyInput } = createMockSlip2GoClient({
      verifySlip: slipOf({ transRef: "SLIP-TX-OK-1", amount: 20 }),
    });

    const result = await verifySlipWithClient(
      t.db,
      1,
      session.id,
      PROMPTPAY_POLICY,
      client,
      "QR-PAYLOAD-FROM-SLIP"
    );
    expect(result.alreadyFinalized).toBe(false);
    expect(result.receipt.sale.total).toBe(20);
    expect(result.slip.transRef).toBe("SLIP-TX-OK-1");
    expect(result.slip.senderName).toBe("ลูกค้าทดสอบ");

    // ส่งเงื่อนไขผู้รับ = บัญชีถุงเงินของร้านเสมอ
    const input = getLastVerifyInput();
    expect(input?.qrCode).toBe("QR-PAYLOAD-FROM-SLIP");
    expect(input?.checkReceiver).toEqual([
      { accountType: "02001", accountNumber: "0812345678" },
    ]);

    const stored = await storedSession(session.id);
    expect(stored?.status).toBe("confirmed");
    expect(stored?.confirmedBy).toBe("auto");
    expect(stored?.transRef).toBe("SLIP-TX-OK-1");

    // สแกนซ้ำบน session เดิม — คืนบิลเดิมโดยไม่เรียก provider อีก (ไม่เสีย quota)
    const again = await verifySlipWithClient(
      t.db,
      1,
      session.id,
      PROMPTPAY_POLICY,
      client,
      "QR-PAYLOAD-FROM-SLIP"
    );
    expect(again.alreadyFinalized).toBe(true);
    expect(again.receipt.sale.id).toBe(result.receipt.sale.id);
    expect(calls.verifySlipByQrCode).toBe(1);
    expect(await saleCount()).toBe(before + 1);
  });

  it("ยอดเงินในสลิปไม่ตรง (แม้ต่างแค่สตางค์เดียว) → ปฏิเสธและ session ยัง pending", async () => {
    const session = await makeSession(2); // 20฿
    const { client } = createMockSlip2GoClient({
      verifySlip: slipOf({ transRef: "SLIP-TX-WRONG-AMT", amount: 20.01 }),
    });
    await expect(
      verifySlipWithClient(t.db, 1, session.id, PROMPTPAY_POLICY, client, "QR")
    ).rejects.toThrow("ไม่ตรงกับยอดบิล");
    expect((await storedSession(session.id))?.status).toBe("pending");
  });

  it("transRef เดียวกันเคยปิดบิลอื่นแล้ว → ปฏิเสธ (สลิป 1 ใบใช้ได้ 1 บิล)", async () => {
    const first = await makeSession(2);
    const { client: clientA } = createMockSlip2GoClient({
      verifySlip: slipOf({ transRef: "SLIP-TX-DUP", amount: 20 }),
    });
    await verifySlipWithClient(
      t.db,
      1,
      first.id,
      PROMPTPAY_POLICY,
      clientA,
      "QR-A"
    );

    // บิลใหม่ยอดเดียวกัน — ลูกค้าเอาสลิปใบเดิมมาใช้ซ้ำ
    const second = await makeSession(2);
    const { client: clientB } = createMockSlip2GoClient({
      verifySlip: slipOf({ transRef: "SLIP-TX-DUP", amount: 20 }),
    });
    await expect(
      verifySlipWithClient(
        t.db,
        1,
        second.id,
        PROMPTPAY_POLICY,
        clientB,
        "QR-B"
      )
    ).rejects.toThrow("ถูกใช้ยืนยันบิลอื่น");
    expect((await storedSession(second.id))?.status).toBe("pending");
  });

  it("session หมดเวลา → mark expired และไม่เรียก provider", async () => {
    const session = await makeSession(2);
    await t.db
      .update(paymentSessions)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(paymentSessions.id, session.id));
    const { client, calls } = createMockSlip2GoClient();
    await expect(
      verifySlipWithClient(t.db, 1, session.id, PROMPTPAY_POLICY, client, "QR")
    ).rejects.toThrow("หมดเวลา");
    expect(calls.verifySlipByQrCode).toBe(0);
    expect((await storedSession(session.id))?.status).toBe("expired");
  });

  it("สลิปเก่ากว่าช่วงเวลาบิล (ก่อนสร้าง session เกิน 5 นาที) → ปฏิเสธ", async () => {
    const session = await makeSession(2);
    const { client } = createMockSlip2GoClient({
      verifySlip: slipOf({
        transRef: "SLIP-TX-OLD",
        amount: 20,
        dateTime: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      }),
    });
    await expect(
      verifySlipWithClient(t.db, 1, session.id, PROMPTPAY_POLICY, client, "QR")
    ).rejects.toThrow("ช่วงเวลาชำระ");
    expect((await storedSession(session.id))?.status).toBe("pending");
  });

  it("สลิปไม่ได้โอนเข้าบัญชีของร้าน (checkReceiver ไม่ผ่าน) → ข้อความเตือนบัญชีปลายทาง", async () => {
    const session = await makeSession(2);
    const { client } = createMockSlip2GoClient({
      verifySlip: new Slip2GoError(
        "receiver account does not match condition",
        "400101",
        400
      ),
    });
    await expect(
      verifySlipWithClient(t.db, 1, session.id, PROMPTPAY_POLICY, client, "QR")
    ).rejects.toThrow("ไม่ได้โอนเข้าบัญชีถุงเงินของร้าน");
    expect((await storedSession(session.id))?.status).toBe("pending");
  });

  it("สลิปซ้ำตามระบบ Slip2Go (checkDuplicate) → ข้อความเตือนสลิปซ้ำ", async () => {
    const session = await makeSession(2);
    const { client } = createMockSlip2GoClient({
      verifySlip: new Slip2GoError("this slip is duplicated", "400201", 400),
    });
    await expect(
      verifySlipWithClient(t.db, 1, session.id, PROMPTPAY_POLICY, client, "QR")
    ).rejects.toThrow("สลิปซ้ำ");
  });

  it("สลิปไม่พบ/QR ไม่ใช่สลิป → ข้อความสลิปไม่ถูกต้อง", async () => {
    const session = await makeSession(2);
    const { client } = createMockSlip2GoClient({
      verifySlip: new Slip2GoError("slip not found", "404001", 404),
    });
    await expect(
      verifySlipWithClient(t.db, 1, session.id, PROMPTPAY_POLICY, client, "QR")
    ).rejects.toThrow("สลิปไม่ถูกต้องหรือไม่พบในระบบธนาคาร");
  });
});

describe("verifySlipWithClient — โหมด merchant (QR ร้านค้าถุงเงิน)", () => {
  it("ไม่ส่ง checkReceiver ให้ provider — ส่ง checkDuplicate อย่างเดียว", async () => {
    const session = await makeSession(2);
    const { client, getLastVerifyInput } = createMockSlip2GoClient({
      verifySlip: slipOf({
        transRef: "SLIP-MERCH-1",
        amount: 20,
        receiverProxyAccount: "2214117056022000909",
      }),
    });
    await verifySlipWithClient(
      t.db,
      1,
      session.id,
      MERCHANT_POLICY,
      client,
      "QR"
    );
    expect(getLastVerifyInput()?.checkReceiver).toEqual([]);
  });

  it("ผู้รับตรง ref1 (proxy account) → ปิดบิล", async () => {
    const session = await makeSession(2);
    const { client } = createMockSlip2GoClient({
      verifySlip: slipOf({
        transRef: "SLIP-MERCH-2",
        amount: 20,
        receiverProxyAccount: "2214117056022000909",
      }),
    });
    const result = await verifySlipWithClient(
      t.db,
      1,
      session.id,
      MERCHANT_POLICY,
      client,
      "QR"
    );
    expect(result.alreadyFinalized).toBe(false);
    expect(result.receipt.sale.total).toBe(20);
    expect((await storedSession(session.id))?.transRef).toBe("SLIP-MERCH-2");
  });

  it("ผู้รับตรง billerId (bank account) → ปิดบิล", async () => {
    const session = await makeSession(2);
    const { client } = createMockSlip2GoClient({
      verifySlip: slipOf({
        transRef: "SLIP-MERCH-3",
        amount: 20,
        receiverBankAccount: "010753700088205",
      }),
    });
    const result = await verifySlipWithClient(
      t.db,
      1,
      session.id,
      MERCHANT_POLICY,
      client,
      "QR"
    );
    expect(result.receipt.sale.total).toBe(20);
  });

  it("ผู้รับเป็นบัญชีอื่น → ปฏิเสธ 'บัญชีปลายทางไม่ใช่ของร้าน' และ session ยัง pending", async () => {
    const session = await makeSession(2);
    const { client } = createMockSlip2GoClient({
      verifySlip: slipOf({
        transRef: "SLIP-MERCH-FOREIGN",
        amount: 20,
        receiverProxyAccount: "9999999999999999999",
        receiverBankAccount: "9999999999",
      }),
    });
    await expect(
      verifySlipWithClient(t.db, 1, session.id, MERCHANT_POLICY, client, "QR")
    ).rejects.toThrow("บัญชีปลายทางไม่ใช่ของร้าน");
    expect((await storedSession(session.id))?.status).toBe("pending");
  });

  it("ผลสลิปไม่มีข้อมูลผู้รับเลย → ปฏิเสธ (ห้ามผ่านแบบเปิด)", async () => {
    const session = await makeSession(2);
    const { client } = createMockSlip2GoClient({
      verifySlip: slipOf({ transRef: "SLIP-MERCH-NORECV", amount: 20 }),
    });
    await expect(
      verifySlipWithClient(t.db, 1, session.id, MERCHANT_POLICY, client, "QR")
    ).rejects.toThrow("บัญชีปลายทางไม่ใช่ของร้าน");
  });
});

describe("payments router — startThungngern / sessionStatus / verifySlip guard", () => {
  it("สร้าง session พร้อม payload ที่ล็อกยอด และ poll ได้สถานะ pending (อ่านอย่างเดียว)", async () => {
    const p = await water();
    const caller = t.caller("cashier");
    const started = await caller.payments.startThungngern({
      staffName: "ทดสอบ",
      items: [{ productId: p.id, qty: 2 }],
      discount: 0,
      pointsToRedeem: 0,
    });
    expect(started.amount).toBe(20);
    expect(started.refCode).toMatch(/^TNG-[A-Z2-9]{8}$/);
    // payload ต้องล็อกยอด 20.00 และจบด้วย CRC
    expect(started.payload).toContain("540520.00");
    expect(started.payload).toMatch(/6304[0-9A-F]{4}$/);

    const status = await caller.payments.sessionStatus({
      sessionId: started.sessionId,
    });
    expect(status.view.status).toBe("pending");
    expect(status.view.secondsLeft).toBeGreaterThan(0);
    expect(status.receipt).toBeNull();

    // manual confirm ผ่าน router — ปิดบิลและคืน receipt
    const confirmed = await caller.payments.manualConfirm({
      sessionId: started.sessionId,
    });
    expect(confirmed.receipt.sale.total).toBe(20);
    expect(confirmed.receipt.sale.paymentMethod).toBe("thungngern");
  });

  it("verifySlip ปฏิเสธเมื่อยังไม่ได้ตั้ง Slip2Go secret", async () => {
    const p = await water();
    const caller = t.caller("cashier");
    const started = await caller.payments.startThungngern({
      staffName: "ทดสอบ",
      items: [{ productId: p.id, qty: 1 }],
      discount: 0,
      pointsToRedeem: 0,
    });
    await expect(
      caller.payments.verifySlip({
        sessionId: started.sessionId,
        qrCode:
          "00020101021129370016A000000677010111011300668123456785802TH5303764540610.006304ABCD",
      })
    ).rejects.toThrow("ยังตั้งค่าการตรวจสลิปไม่ครบ");
    // session ต้องยัง pending — ยกเลิกทิ้งได้ปกติ
    const status = await caller.payments.sessionStatus({
      sessionId: started.sessionId,
    });
    expect(status.view.status).toBe("pending");
  });

  it("sessionStatus mark expired ให้เมื่อ session ค้างเกินเวลา", async () => {
    const p = await water();
    const caller = t.caller("cashier");
    const started = await caller.payments.startThungngern({
      staffName: "ทดสอบ",
      items: [{ productId: p.id, qty: 1 }],
      discount: 0,
      pointsToRedeem: 0,
    });
    await t.db
      .update(paymentSessions)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(paymentSessions.id, started.sessionId));
    const status = await caller.payments.sessionStatus({
      sessionId: started.sessionId,
    });
    expect(status.view.status).toBe("expired");
  });

  it("โหมด merchant — startThungngern สร้าง QR จาก merchant payload ที่ล็อกยอดถูกต้อง", async () => {
    const p = await water();
    // สลับสาขา 1 เป็นโหมด merchant ชั่วคราว
    await t.db
      .update(paymentSettings)
      .set({ qrMode: "merchant", merchantPayload: OFFICIAL_MERCHANT_QR })
      .where(eq(paymentSettings.branchId, 1));
    try {
      const caller = t.caller("cashier");
      const started = await caller.payments.startThungngern({
        staffName: "ทดสอบ",
        items: [{ productId: p.id, qty: 2 }],
        discount: 0,
        pointsToRedeem: 0,
      });
      // ต้องเป็น QR ร้านค้า (tag 30) ไม่ใช่ PromptPay ส่วนตัว (tag 29)
      expect(started.payload).toContain(
        "30830016A0000006770101120115010753700088205021922141170560220009090317WEERAYUTNAMWONGSA"
      );
      expect(started.payload).not.toContain("29370016A000000677010111");
      // ล็อกยอด 20.00 (tag 54 ยาว 5 ตัว) และจบด้วย CRC ที่ถูกต้อง
      expect(started.payload).toContain("540520.00");
      expect(started.payload).toMatch(/6304[0-9A-F]{4}$/);
      const body = started.payload.slice(0, -4);
      expect(crc16Ccitt(body).toString(16).toUpperCase().padStart(4, "0")).toBe(
        started.payload.slice(-4)
      );
      await caller.payments.cancelSession({ sessionId: started.sessionId });
    } finally {
      await t.db
        .update(paymentSettings)
        .set({ qrMode: "promptpay", merchantPayload: null })
        .where(eq(paymentSettings.branchId, 1));
    }
  });

  it("โหมด merchant — updateConfig ปฏิเสธ payload ที่ไม่ใช่ QR ร้านค้า", async () => {
    const admin = t.caller("admin");
    await expect(
      admin.payments.updateConfig({
        thungngernEnabled: true,
        promptpayId: "",
        qrMode: "merchant",
        merchantPayload: "0002010102110junk-payload",
      })
    ).rejects.toThrow();
    // payload จริงผ่าน และ summary คืนข้อมูลร้านค้า
    const saved = await admin.payments.updateConfig({
      thungngernEnabled: true,
      promptpayId: "",
      qrMode: "merchant",
      merchantPayload: OFFICIAL_MERCHANT_QR,
    });
    expect(saved.config.qrMode).toBe("merchant");
    expect(saved.config.merchant).toEqual({
      billerId: "010753700088205",
      ref1: "2214117056022000909",
      ref2: "WEERAYUTNAMWONGSA",
    });
    // คืนโหมดเดิมให้ test อื่น
    await admin.payments.updateConfig({
      thungngernEnabled: true,
      promptpayId: "0812345678",
      qrMode: "promptpay",
    });
  });

  it("ยกเลิก session แล้ว poll ได้สถานะ cancelled", async () => {
    const p = await water();
    const caller = t.caller("cashier");
    const started = await caller.payments.startThungngern({
      staffName: "ทดสอบ",
      items: [{ productId: p.id, qty: 1 }],
      discount: 0,
      pointsToRedeem: 0,
    });
    await caller.payments.cancelSession({ sessionId: started.sessionId });
    const status = await caller.payments.sessionStatus({
      sessionId: started.sessionId,
    });
    expect(status.view.status).toBe("cancelled");
  });
});
