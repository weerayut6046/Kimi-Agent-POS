import { and, eq, gt, gte, sql } from "drizzle-orm";
import {
  members,
  paymentSessions,
  pointTransactions,
  products,
  saleItems,
  sales,
  type PaymentSession,
} from "@db/schema";
import type {
  PaymentConfirmedBy,
  ThungngernSaleSnapshot,
  ThungngernSessionView,
} from "@contracts/payments";
import type { DesktopReceipt } from "@contracts/offline";
import {
  DEFAULT_SETTINGS,
  DEFAULT_POINT_EARN_PER_BAHT,
  DEFAULT_POINT_REDEEM_VALUE,
  positiveSettingNumber,
} from "@contracts/settings";
import {
  activeReceiptPromotion,
  appliedPromotionDiscount,
} from "@contracts/promotion";
import { getDb } from "../queries/connection";
import { nextDocNo } from "../lib/docNumbers";
import { expireDueMemberPoints } from "../lib/memberExpiry";
import { isMemberCardExpired } from "@contracts/memberExpiry";
import {
  isDuplicateSlipError,
  Slip2GoError,
  type Slip2GoClient,
  type Slip2GoReceiverCondition,
  type Slip2GoVerifiedSlip,
} from "./slip2go-client";

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** session รอชำระมีอายุ 5 นาที — QR ล็อกยอดจึงไม่ควรค้างนานกว่านั้น */
export const THUNGNGERN_SESSION_TTL_MS = 5 * 60 * 1000;
/** ยอมรับสลิปที่เกิดก่อนสร้าง session ได้ไม่เกิน 5 นาที (ลูกค้าอาจสแกน QR ทันที) */
export const SLIP_PAID_AT_GRACE_MS = 5 * 60 * 1000;
/** เผื่อนาฬิกาเซิร์ฟเวอร์ธนาคารเร็วกว่าเราเล็กน้อย */
const SLIP_FUTURE_GRACE_MS = 30 * 1000;

type Db = ReturnType<typeof getDb>;
type DbTx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export type ThungngernSaleInput = {
  shiftId?: number;
  staffName: string;
  memberId?: number;
  items: Array<{ productId: number; qty: number }>;
  discount: number;
  pointsToRedeem: number;
  loyaltyChoice?: "earn" | "redeem";
};

export type FinalizeResult = {
  alreadyFinalized: boolean;
  receipt: DesktopReceipt & { sale: DesktopReceipt["sale"] };
};

/** คำนวณยอดบิลฝั่งเซิร์ฟเวอร์และล็อกเป็น snapshot (ตรรกะเดียวกับ pos.createSale) */
export async function computeSaleSnapshot(
  db: Db,
  branchId: number,
  input: ThungngernSaleInput,
  settingMap: Record<string, string>
): Promise<ThungngernSaleSnapshot> {
  if (input.items.length === 0) throw new Error("ไม่มีสินค้าในบิล");
  const prodRows = await db.query.products.findMany({
    where: eq(products.branchId, branchId),
  });
  const lines = input.items.map(it => {
    const p = prodRows.find(pr => pr.id === it.productId);
    if (!p || !p.active) throw new Error("ไม่พบสินค้าบางรายการ");
    return { product: p, qty: it.qty, amount: r2(p.price * it.qty) };
  });
  const requestedStock = new Map<number, number>();
  for (const line of lines) {
    if (line.product.category === "fuel") continue;
    requestedStock.set(
      line.product.id,
      r3((requestedStock.get(line.product.id) ?? 0) + line.qty)
    );
  }
  for (const [productId, qty] of requestedStock) {
    const product = prodRows.find(row => row.id === productId)!;
    if (product.stockQty <= 0) {
      throw new Error(`${product.name} หมดแล้ว ไม่สามารถขายได้`);
    }
    if (qty > product.stockQty) {
      throw new Error(
        `สต๊อก ${product.name} ไม่พอ (เหลือ ${product.stockQty} ${product.unit})`
      );
    }
  }
  const subtotal = r2(lines.reduce((s, l) => s + l.amount, 0));

  const vatRate = Number(settingMap.vat_rate ?? "7");
  const earnPer = positiveSettingNumber(
    settingMap.point_earn_per_baht,
    DEFAULT_POINT_EARN_PER_BAHT
  );
  const pointValue = positiveSettingNumber(
    settingMap.point_redeem_value,
    DEFAULT_POINT_REDEEM_VALUE
  );

  const activePromotion = activeReceiptPromotion({
    ...DEFAULT_SETTINGS,
    ...settingMap,
  });
  const promotionDiscount = appliedPromotionDiscount(
    activePromotion,
    lines.reduce(
      (sum, line) => (line.product.category === "fuel" ? sum + line.qty : sum),
      0
    ),
    subtotal
  );
  if (activePromotion && input.pointsToRedeem > 0) {
    throw new Error(
      "ช่วงโปรโมชั่นไม่สามารถใช้แต้มเป็นส่วนลดหรือรับส่วนลดอื่นร่วมได้"
    );
  }
  const effectivePointsToRedeem = activePromotion ? 0 : input.pointsToRedeem;

  const loyaltyChoice = activePromotion
    ? null
    : (input.loyaltyChoice ??
      (effectivePointsToRedeem > 0 ? "redeem" : "earn"));
  if (!activePromotion && input.loyaltyChoice && !input.memberId) {
    throw new Error("ต้องเลือกสมาชิกก่อนเลือกวิธีใช้แต้ม");
  }
  if (
    !activePromotion &&
    input.loyaltyChoice === "earn" &&
    effectivePointsToRedeem > 0
  ) {
    throw new Error("ไม่สามารถสะสมแต้มและใช้แต้มในบิลเดียวกันได้");
  }
  if (
    !activePromotion &&
    input.loyaltyChoice === "redeem" &&
    effectivePointsToRedeem === 0
  ) {
    throw new Error("กรุณาระบุจำนวนแต้มที่ต้องการใช้เป็นส่วนลด");
  }
  if (effectivePointsToRedeem > 0 && !input.memberId) {
    throw new Error("ต้องเลือกสมาชิกก่อนใช้แต้ม");
  }
  let redeemDiscount = 0;
  let memberId: number | null = null;
  if (input.memberId) {
    await expireDueMemberPoints(db, branchId);
    const member = await db.query.members.findFirst({
      where: eq(members.id, input.memberId),
    });
    if (!member) throw new Error("ไม่พบสมาชิก");
    if (isMemberCardExpired(member.cardExpiresAt)) {
      throw new Error("บัตรสมาชิกหมดอายุแล้ว กรุณาต่ออายุบัตรก่อนใช้งาน");
    }
    memberId = member.id;
    if (effectivePointsToRedeem > 0) {
      if (effectivePointsToRedeem > member.points) throw new Error("แต้มไม่พอ");
      redeemDiscount = r2(effectivePointsToRedeem * pointValue);
    }
  }
  const totalDiscount = r2(
    (activePromotion ? promotionDiscount : input.discount) + redeemDiscount
  );
  if (totalDiscount > subtotal) throw new Error("ส่วนลดมากกว่ายอดขาย");

  const total = r2(subtotal - totalDiscount);
  const vatAmount = r2((total * vatRate) / (100 + vatRate)); // VAT รวมใน
  const pointsEarned =
    !activePromotion && memberId && loyaltyChoice === "earn"
      ? Math.floor(total / earnPer)
      : 0;

  return {
    items: lines.map(l => ({
      productId: l.product.id,
      name: l.product.name,
      qty: l.qty,
      unit: l.product.unit,
      unitPrice: l.product.price,
      amount: l.amount,
      category: l.product.category,
    })),
    subtotal,
    discount: totalDiscount,
    vatRate,
    vatAmount,
    total,
    memberId,
    pointsToRedeem: memberId ? effectivePointsToRedeem : 0,
    pointsEarned,
    shiftId: input.shiftId ?? null,
    staffName: input.staffName,
  };
}

function newRefCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // ตัดตัวที่อ่านสับสน (0/O, 1/I)
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  let code = "";
  for (const byte of bytes) code += alphabet[byte % alphabet.length];
  return `TNG-${code}`;
}

export function buildSessionView(
  session: PaymentSession,
  now = new Date()
): ThungngernSessionView {
  return {
    id: session.id,
    refCode: session.refCode,
    status: session.status,
    amount: session.amount,
    expiresAt: session.expiresAt,
    secondsLeft: Math.max(
      0,
      Math.ceil((session.expiresAt.getTime() - now.getTime()) / 1000)
    ),
    confirmedBy: session.confirmedBy,
    externalRef: session.externalRef,
  };
}

/** สร้าง session รอชำระ + payload PromptPay ที่ล็อกยอด (refCode ชน → สุ่มใหม่) */
export async function startThungngernSession(
  db: Db,
  branchId: number,
  snapshot: ThungngernSaleSnapshot
): Promise<PaymentSession> {
  const expiresAt = new Date(Date.now() + THUNGNGERN_SESSION_TTL_MS);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const refCode = newRefCode();
    const inserted = await db
      .insert(paymentSessions)
      .values({
        branchId,
        refCode,
        amount: snapshot.total,
        saleSnapshot: snapshot,
        expiresAt,
      })
      .onConflictDoNothing({
        target: [paymentSessions.branchId, paymentSessions.refCode],
      })
      .returning();
    if (inserted[0]) return inserted[0];
  }
  throw new Error("สร้างรหัสอ้างอิงการชำระไม่สำเร็จ กรุณาลองใหม่");
}

/** บันทึกบิลจาก snapshot ภายใน transaction (ตรรกะเดียวกับ pos.createSale) */
async function insertSaleFromSnapshot(
  tx: DbTx,
  branchId: number,
  snapshot: ThungngernSaleSnapshot
): Promise<number> {
  const receiptNo = await nextDocNo(tx, "receipt", branchId);
  const [inserted] = await tx
    .insert(sales)
    .values({
      branchId,
      receiptNo,
      shiftId: snapshot.shiftId,
      staffName: snapshot.staffName,
      memberId: snapshot.memberId,
      customerId: null,
      subtotal: snapshot.subtotal,
      discount: snapshot.discount,
      vatRate: snapshot.vatRate,
      vatAmount: snapshot.vatAmount,
      total: snapshot.total,
      paymentMethod: "thungngern",
      received: snapshot.total,
      changeAmt: 0,
      pointsEarned: snapshot.pointsEarned,
      pointsRedeemed: snapshot.pointsToRedeem,
    })
    .returning({ id: sales.id });
  const saleId = inserted!.id;

  await tx.insert(saleItems).values(
    snapshot.items.map(l => ({
      branchId,
      saleId,
      productId: l.productId,
      name: l.name,
      qty: l.qty,
      unit: l.unit,
      unitPrice: l.unitPrice,
      amount: l.amount,
    }))
  );
  for (const l of snapshot.items) {
    // หักสต๊อกเฉพาะสินค้าที่ไม่ใช่น้ำมัน (น้ำมันหักผ่านมิเตอร์ตอนปิดกะ)
    if (l.category !== "fuel") {
      const updated = await tx
        .update(products)
        .set({ stockQty: sql`${products.stockQty} - ${l.qty}` })
        .where(
          and(
            eq(products.id, l.productId),
            eq(products.branchId, branchId),
            gte(products.stockQty, l.qty)
          )
        )
        .returning({ stockQty: products.stockQty });
      if (!updated[0]) {
        const current = await tx.query.products.findFirst({
          columns: { stockQty: true, unit: true },
          where: and(
            eq(products.id, l.productId),
            eq(products.branchId, branchId)
          ),
        });
        if (!current || current.stockQty <= 0) {
          throw new Error(`${l.name} หมดแล้ว ไม่สามารถขายได้`);
        }
        throw new Error(
          `สต๊อก ${l.name} ไม่พอ (เหลือ ${current.stockQty} ${current.unit})`
        );
      }
    }
  }

  if (snapshot.memberId) {
    const updatedMember = await tx
      .update(members)
      .set({
        points: sql`${members.points} - ${snapshot.pointsToRedeem} + ${snapshot.pointsEarned}`,
      })
      .where(
        and(
          eq(members.id, snapshot.memberId),
          gte(members.points, snapshot.pointsToRedeem),
          gt(members.cardExpiresAt, new Date())
        )
      )
      .returning({ id: members.id });
    if (!updatedMember[0]) throw new Error("แต้มไม่พอ");
    if (snapshot.pointsEarned > 0) {
      await tx.insert(pointTransactions).values({
        branchId,
        memberId: snapshot.memberId,
        saleId,
        type: "earn",
        points: snapshot.pointsEarned,
        note: `รับแต้มจากบิล ${receiptNo}`,
      });
    }
    if (snapshot.pointsToRedeem > 0) {
      await tx.insert(pointTransactions).values({
        branchId,
        memberId: snapshot.memberId,
        saleId,
        type: "redeem",
        points: -snapshot.pointsToRedeem,
        note: `ใช้แต้มลดบิล ${receiptNo}`,
      });
    }
  }
  return saleId;
}

async function loadReceipt(
  db: Db,
  branchId: number,
  saleId: number
): Promise<FinalizeResult["receipt"]> {
  const sale = await db.query.sales.findFirst({
    where: and(eq(sales.id, saleId), eq(sales.branchId, branchId)),
  });
  if (!sale) throw new Error("ไม่พบบิลที่ปิดการขายแล้ว");
  const items = await db
    .select()
    .from(saleItems)
    .where(and(eq(saleItems.saleId, saleId), eq(saleItems.branchId, branchId)));
  const member = sale.memberId
    ? await db.query.members.findFirst({
        where: eq(members.id, sale.memberId),
      })
    : null;
  return {
    sale: { ...sale, memberName: member?.name ?? null, customerName: null },
    items,
  };
}

/**
 * ปิด session และสร้างบิล — idempotent:
 * claim ด้วย conditional update (status pending → confirmed) ใน transaction เดียวกับการสร้างบิล
 * ดังนั้นการตรวจสลิป + ปุ่มยืนยันเองที่มาพร้อมกันจะปิดบิลได้ครั้งเดียว
 */
export async function finalizeThungngernSession(
  db: Db,
  branchId: number,
  sessionId: number,
  confirmedBy: PaymentConfirmedBy,
  externalRef: string | null = null
): Promise<FinalizeResult> {
  const claimedSaleId = await db.transaction(async tx => {
    const claimed = await tx
      .update(paymentSessions)
      .set({
        status: "confirmed",
        confirmedBy,
        externalRef,
        // externalRef ของการชำระผ่านสลิปคือ transRef ของธนาคาร — บันทึกแยกคอลัมน์
        // เพื่อบังคับ unique (สลิป 1 ใบใช้ปิดบิลได้ครั้งเดียว)
        transRef: externalRef,
        confirmedAt: new Date(),
      })
      .where(
        and(
          eq(paymentSessions.id, sessionId),
          eq(paymentSessions.branchId, branchId),
          eq(paymentSessions.status, "pending")
        )
      )
      .returning({ id: paymentSessions.id });
    if (!claimed[0]) return null;

    const session = await tx.query.paymentSessions.findFirst({
      where: eq(paymentSessions.id, sessionId),
    });
    if (!session) throw new Error("ไม่พบ session การชำระเงิน");
    const saleId = await insertSaleFromSnapshot(
      tx,
      branchId,
      session.saleSnapshot
    );
    await tx
      .update(paymentSessions)
      .set({ saleId })
      .where(eq(paymentSessions.id, sessionId));
    return saleId;
  });

  if (claimedSaleId != null) {
    return {
      alreadyFinalized: false,
      receipt: await loadReceipt(db, branchId, claimedSaleId),
    };
  }

  // มีคนปิดไปแล้ว (หรือถูกยกเลิก/หมดเวลา) — ถ้าเป็นบิลเดียวกันให้คืนบิลเดิม (idempotent)
  const session = await db.query.paymentSessions.findFirst({
    where: and(
      eq(paymentSessions.id, sessionId),
      eq(paymentSessions.branchId, branchId)
    ),
  });
  if (!session) throw new Error("ไม่พบ session การชำระเงิน");
  if (session.status === "confirmed" && session.saleId != null) {
    return {
      alreadyFinalized: true,
      receipt: await loadReceipt(db, branchId, session.saleId),
    };
  }
  if (session.status === "cancelled") {
    throw new Error("session การชำระนี้ถูกยกเลิกแล้ว");
  }
  if (session.status === "expired") {
    throw new Error("session การชำระนี้หมดเวลาแล้ว กรุณาสร้าง QR ใหม่");
  }
  throw new Error("ปิด session การชำระไม่สำเร็จ กรุณาลองใหม่");
}

export type SlipVerifyResult = {
  alreadyFinalized: boolean;
  receipt: FinalizeResult["receipt"];
  slip: {
    transRef: string;
    amount: number;
    senderName: string | null;
    paidAt: string;
  };
};

/** เลือก accountType ของ Slip2Go ตาม PromptPay ID: 10 หลัก = เบอร์โทร, 13 หลัก = บัตรประชาชน/นิติบุคคล */
export function receiverConditionFromPromptPayId(
  promptpayId: string
): Slip2GoReceiverCondition {
  const digits = promptpayId.replace(/\D/g, "");
  if (digits.length === 10)
    return { accountType: "02001", accountNumber: digits };
  if (digits.length === 13)
    return { accountType: "02003", accountNumber: digits };
  throw new Error(
    "PromptPay ID ที่ตั้งค่าไว้ไม่ถูกต้อง (ต้องเป็นเบอร์โทร 10 หลัก หรือเลข 13 หลัก)"
  );
}

/**
 * นโยบายตรวจบัญชีปลายทางของสลิป:
 * - slip2go: ส่ง checkReceiver ให้ Slip2Go ตรวจ (โหมด PromptPay ส่วนตัว)
 * - local: ไม่ส่ง checkReceiver (Slip2Go ไม่มี accountType สำหรับ biller QR ถุงเงิน)
 *   แล้วตรวจเองจากผลสลิปว่า proxy/bank account ตรง ref1 หรือ billerId ของร้าน
 */
export type SlipReceiverPolicy =
  | { kind: "slip2go"; conditions: Slip2GoReceiverCondition[] }
  | { kind: "local"; acceptedAccounts: string[] };

/** แปลง error จาก Slip2Go เป็นข้อความไทยที่แคชเชียร์เข้าใจ */
function slipVerifyErrorMessage(error: Slip2GoError): string {
  if (error.code === "SLIP2GO_TIMEOUT" || error.code === "SLIP2GO_NETWORK") {
    return error.message;
  }
  if (isDuplicateSlipError(error)) {
    return "สลิปนี้ถูกตรวจสอบไปแล้ว (สลิปซ้ำ) — กรุณาใช้สลิปของรายการนี้เท่านั้น";
  }
  const text = error.message.toLowerCase();
  if (/receiver|account/.test(text)) {
    return "สลิปนี้ไม่ได้โอนเข้าบัญชีถุงเงินของร้าน — กรุณาตรวจสลิปอีกครั้ง";
  }
  return "สลิปไม่ถูกต้องหรือไม่พบในระบบธนาคาร — กรุณาสแกนสลิปจากแอปธนาคารของลูกค้า";
}

/**
 * ตรวจสลิปจาก QR ที่แคชเชียร์สแกน แล้วปิดบิลถ้าผ่านทุกเงื่อนไข:
 * 1. Slip2Go ยืนยันสลิปจริงและไม่ซ้ำ; ผู้รับถูกต้องตาม receiverPolicy
 *    (promptpay → checkReceiver ของ Slip2Go, merchant → ตรวจเองจากผลสลิป)
 * 2. ยอดเงินตรงกับยอดบิลแบบแม่นยำระดับสตางค์ (ตรวจเองฝั่งเซิร์ฟเวอร์)
 * 3. เวลารายการอยู่ในช่วง [สร้าง session − 5 นาที, ตอนนี้] (ตรวจเองฝั่งเซิร์ฟเวอร์)
 * 4. transRef ยังไม่เคยใช้ปิดบิลอื่นของสาขานี้
 */
export async function verifySlipWithClient(
  db: Db,
  branchId: number,
  sessionId: number,
  receiverPolicy: SlipReceiverPolicy,
  client: Slip2GoClient,
  qrCode: string,
  now = new Date()
): Promise<SlipVerifyResult> {
  const session = await db.query.paymentSessions.findFirst({
    where: and(
      eq(paymentSessions.id, sessionId),
      eq(paymentSessions.branchId, branchId)
    ),
  });
  if (!session) throw new Error("ไม่พบ session การชำระเงิน");

  // ปิดไปแล้ว — คืนบิลเดิมโดยไม่เสีย quota ตรวจซ้ำ (idempotent)
  if (session.status === "confirmed" && session.saleId != null) {
    const receipt = await loadReceipt(db, branchId, session.saleId);
    return {
      alreadyFinalized: true,
      receipt,
      slip: {
        transRef: session.transRef ?? session.externalRef ?? "",
        amount: session.amount,
        senderName: null,
        paidAt: session.confirmedAt?.toISOString() ?? now.toISOString(),
      },
    };
  }
  if (session.status === "cancelled") {
    throw new Error("session การชำระนี้ถูกยกเลิกแล้ว กรุณาสร้าง QR ใหม่");
  }
  if (session.status === "expired") {
    throw new Error("session การชำระนี้หมดเวลาแล้ว กรุณาสร้าง QR ใหม่");
  }
  if (now.getTime() >= session.expiresAt.getTime()) {
    await db
      .update(paymentSessions)
      .set({ status: "expired" })
      .where(
        and(
          eq(paymentSessions.id, sessionId),
          eq(paymentSessions.status, "pending")
        )
      );
    throw new Error("session การชำระนี้หมดเวลาแล้ว กรุณาสร้าง QR ใหม่");
  }

  let slip: Slip2GoVerifiedSlip;
  try {
    slip = await client.verifySlipByQrCode({
      qrCode,
      checkReceiver:
        receiverPolicy.kind === "slip2go" ? receiverPolicy.conditions : [],
    });
  } catch (error) {
    if (error instanceof Slip2GoError) {
      throw new Error(slipVerifyErrorMessage(error));
    }
    throw error;
  }

  if (!slip.transRef) {
    throw new Error("ผลตรวจสลิปไม่สมบูรณ์ (ไม่มีรหัสรายการ) กรุณาลองใหม่");
  }

  // โหมด merchant (QR ร้านค้าถุงเงิน) — ตรวจบัญชีปลายทางเองจากผลสลิป
  // หมายเหตุ: รูปร่าง receiver ของสลิปที่จ่ายเข้า biller QR ถุงเงินยังไม่ได้ยืนยัน
  // กับสลิปจริง (รอทดสอบโอน 1 บาทครั้งแรก) — จึง log receiver ไว้ debug ทุกครั้ง
  if (receiverPolicy.kind === "local") {
    console.log("thungngern slip receiver (merchant mode)", {
      sessionId,
      proxyType: slip.receiverProxyType,
      proxyAccount: slip.receiverProxyAccount,
      bankAccount: slip.receiverBankAccount,
    });
    const accepted = new Set(
      receiverPolicy.acceptedAccounts.map(a => a.replace(/\D/g, "") || a)
    );
    const candidates = [slip.receiverProxyAccount, slip.receiverBankAccount]
      .filter((a): a is string => !!a)
      .flatMap(a => [a, a.replace(/\D/g, "") || a]);
    if (!candidates.some(candidate => accepted.has(candidate))) {
      throw new Error(
        "บัญชีปลายทางไม่ใช่ของร้าน — สลิปนี้ไม่ได้โอนเข้าบัญชีถุงเงินของร้าน"
      );
    }
  }

  // ยอดต้องตรงเป๊ะระดับสตางค์ — ห้ามปัด/เผื่อ
  if (Math.abs(r2(slip.amount) - r2(session.amount)) >= 0.005) {
    throw new Error(
      `ยอดเงินในสลิป (${r2(slip.amount).toFixed(2)} บาท) ไม่ตรงกับยอดบิล (${r2(session.amount).toFixed(2)} บาท)`
    );
  }

  const paidAtMs = Date.parse(slip.dateTime);
  if (
    Number.isNaN(paidAtMs) ||
    paidAtMs < session.createdAt.getTime() - SLIP_PAID_AT_GRACE_MS ||
    paidAtMs > now.getTime() + SLIP_FUTURE_GRACE_MS
  ) {
    throw new Error(
      "สลิปนี้ไม่ได้อยู่ในช่วงเวลาชำระของบิลนี้ — กรุณาใช้สลิปของรายการนี้"
    );
  }

  // สลิป 1 ใบใช้ได้ 1 บิล — กันนำสลิปเดิมมายืนยันบิลยอดเดียวกันซ้ำ
  const reused = await db.query.paymentSessions.findFirst({
    where: and(
      eq(paymentSessions.branchId, branchId),
      eq(paymentSessions.transRef, slip.transRef),
      eq(paymentSessions.status, "confirmed")
    ),
  });
  if (reused && reused.id !== sessionId) {
    throw new Error("สลิปนี้ถูกใช้ยืนยันบิลอื่นไปแล้ว — สลิป 1 ใบใช้ได้ 1 บิล");
  }

  const result = await finalizeThungngernSession(
    db,
    branchId,
    sessionId,
    "auto",
    slip.transRef
  );
  return {
    alreadyFinalized: result.alreadyFinalized,
    receipt: result.receipt,
    slip: {
      transRef: slip.transRef,
      amount: r2(slip.amount),
      senderName: slip.senderName,
      paidAt: slip.dateTime,
    },
  };
}
