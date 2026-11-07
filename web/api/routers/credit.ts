import { z } from "zod";
import { and, asc, desc, eq, like, or, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createRouter, publicQuery } from "../middleware";
import { managerQuery } from "../guard";
import { getDb } from "../queries/connection";
import { nextDocNo } from "../lib/docNumbers";
import { logAudit } from "../lib/audit";
import { publishRealtimeInvalidation } from "../lib/realtime";
import {
  calculateCreditLedger,
  creditCheckoutState,
  lockCreditCustomer,
  readCreditAccount,
  readCreditLedgerRows,
  readCustomerCredit,
} from "../lib/creditLedger";
import {
  creditAccounts,
  creditEvents,
  customers,
  sales,
  shifts,
  debtPayments,
} from "@db/schema";
import { bangkokDateKey } from "@contracts/promotion";
import { roundSaleMoney } from "@contracts/saleItemValues";

const customerInput = z.object({ customerId: z.number().int().positive() });
const documentRef = z.string().trim().min(1, "กรุณาระบุเลขอ้างอิงเอกสาร").max(160);
const historicalDate = z.iso.date().refine(
  date => date <= bangkokDateKey(new Date()),
  "วันที่เอกสารหรือเหตุการณ์ต้องไม่เป็นวันในอนาคต"
);
const approvalInput = customerInput.extend({
  verified: z.literal(true),
  buyerType: z.enum(["individual", "company"]),
  limit: z.number().min(0.01).max(1_000_000_000),
  days: z.number().int().min(1).max(365),
  agreementRef: documentRef,
  signedOn: historicalDate,
  applicationRef: documentRef,
  identityRef: documentRef,
  receiversRef: documentRef,
  privacyNoticeRef: documentRef,
  authorityRef: documentRef.optional(),
}).refine(
  input => input.buyerType !== "company" || input.authorityRef !== undefined,
  { path: ["authorityRef"], message: "กรุณาระบุหลักฐานอำนาจลงนามของนิติบุคคล" }
);

const followUpBase = customerInput.extend({
  occurredOn: historicalDate,
  reference: documentRef,
  notes: z.string().trim().min(5, "กรุณาระบุรายละเอียด").max(2000),
});
const followUpInput = z.discriminatedUnion("kind", [
  followUpBase.extend({ kind: z.literal("notice") }),
  followUpBase.extend({ kind: z.literal("dispute") }),
  followUpBase.extend({
    kind: z.literal("legal_review"),
    reviewRoute: z.enum(["civil", "suspected_fraud"]),
    notes: z.string().trim().min(20, "กรุณาระบุข้อเท็จจริงและเหตุผลที่ส่งตรวจ").max(2000),
  }),
]);

function groupByCustomer<T extends { customerId: number | null }>(rows: T[]) {
  const groups = new Map<number, T[]>();
  for (const row of rows) {
    if (row.customerId === null) continue;
    const group = groups.get(row.customerId);
    if (group) group.push(row);
    else groups.set(row.customerId, [row]);
  }
  return groups;
}

async function findCustomer(db: ReturnType<typeof getDb>, id: number) {
  const customer = await db.query.customers.findFirst({
    where: eq(customers.id, id),
  });
  if (!customer) throw new TRPCError({ code: "NOT_FOUND", message: "ไม่พบลูกค้า" });
  return customer;
}

export const creditRouter = createRouter({
  summary: publicQuery
    .input(z.object({ q: z.string().trim().max(120).optional() }).optional())
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const { branchId } = ctx.staff;
      const pattern = input?.q ? `%${input.q}%` : null;
      const [customerRows, accounts, ledgerRows] = await Promise.all([
        db.select().from(customers).where(
          pattern
            ? or(like(customers.name, pattern), like(customers.phone, pattern), like(customers.taxId, pattern))
            : undefined
        ),
        db.select().from(creditAccounts).where(eq(creditAccounts.branchId, branchId)),
        readCreditLedgerRows(db, branchId),
      ]);
      const accountsByCustomer = new Map(accounts.map(account => [account.customerId, account]));
      const salesByCustomer = groupByCustomer(ledgerRows.creditSales);
      const paymentsByCustomer = groupByCustomer(ledgerRows.payments);
      const now = new Date();
      const today = bangkokDateKey(now);
      return customerRows.map(customer => {
        const ledger = calculateCreditLedger(
          salesByCustomer.get(customer.id) ?? [],
          paymentsByCustomer.get(customer.id) ?? [],
          today
        );
        const account = accountsByCustomer.get(customer.id);
        const checkout = creditCheckoutState(account, customer.creditLimit, ledger, now);
        return {
          ...customer,
          outstanding: ledger.outstanding,
          overdue: ledger.overdue,
          unknownDue: ledger.unknownDue,
          creditStatus: checkout.status,
          approvedLimit: account?.terms?.limit ?? checkout.limit,
        };
      }).sort((a, b) => b.overdue - a.overdue || b.outstanding - a.outstanding);
    }),

  detail: publicQuery.input(customerInput).query(async ({ input, ctx }) => {
    const db = getDb();
    const { branchId } = ctx.staff;
    const now = new Date();
    const [customer, account, ledger] = await Promise.all([
      findCustomer(db, input.customerId),
      readCreditAccount(db, branchId, input.customerId),
      readCustomerCredit(db, branchId, input.customerId, now),
    ]);
    return {
      customer,
      ...ledger,
      payments: ledger.payments.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id - a.id),
      ...creditCheckoutState(account, customer.creditLimit, ledger, now),
    };
  }),

  // POS ต้องการเพียงสถานะ วงเงิน และวันกำหนดชำระ ไม่ต้องส่งเอกสารของลูกค้า
  checkout: publicQuery.input(customerInput).query(async ({ input, ctx }) => {
    const db = getDb();
    const { branchId } = ctx.staff;
    const now = new Date();
    const [customer, account, ledger] = await Promise.all([
      findCustomer(db, input.customerId),
      readCreditAccount(db, branchId, input.customerId),
      readCustomerCredit(db, branchId, input.customerId, now),
    ]);
    return creditCheckoutState(account, customer.creditLimit, ledger, now);
  }),

  approveAccount: managerQuery.input(approvalInput).mutation(async ({ input, ctx }) => {
    const { branchId, id: actorId, name: actorName } = ctx.staff;
    const { customerId, verified, ...requested } = input;
    const terms = { ...requested, limit: roundSaleMoney(requested.limit) };
    await getDb().transaction(async tx => {
      await lockCreditCustomer(tx, customerId);
      await tx.insert(creditAccounts).values({
        branchId, customerId, status: "approved", terms,
      }).onConflictDoUpdate({
        target: [creditAccounts.branchId, creditAccounts.customerId],
        set: { status: "approved", terms, updatedAt: new Date() },
      });
      await tx.insert(creditEvents).values({
        branchId, customerId, kind: "approval",
        data: { terms, notes: verified ? "ตรวจเอกสารต้นฉบับแล้ว" : undefined },
        actorId, actorName,
      });
    });
    publishRealtimeInvalidation(branchId);
    return { ok: true };
  }),

  suspendAccount: managerQuery
    .input(customerInput.extend({ reason: z.string().trim().min(3).max(500) }))
    .mutation(async ({ input, ctx }) => {
      const { branchId, id: actorId, name: actorName } = ctx.staff;
      await getDb().transaction(async tx => {
        await lockCreditCustomer(tx, input.customerId);
        const account = await readCreditAccount(tx, branchId, input.customerId);
        if (!account) throw new Error("สาขานี้ยังไม่มีบัญชีเครดิตของลูกค้า");
        if (account.status === "suspended") return;
        await tx.update(creditAccounts).set({ status: "suspended", updatedAt: new Date() })
          .where(and(eq(creditAccounts.branchId, branchId), eq(creditAccounts.customerId, input.customerId)));
        await tx.insert(creditEvents).values({
          branchId, customerId: input.customerId, kind: "suspension",
          data: { notes: input.reason }, actorId, actorName,
        });
      });
      publishRealtimeInvalidation(branchId);
      return { ok: true };
    }),

  recordFollowUp: managerQuery.input(followUpInput).mutation(async ({ input, ctx }) => {
    const { branchId, id: actorId, name: actorName } = ctx.staff;
    const { customerId, kind, ...data } = input;
    const db = getDb();
    await db.transaction(async tx => {
      await lockCreditCustomer(tx, customerId);
      if (!(await readCreditAccount(tx, branchId, customerId))) {
        throw new Error("สาขานี้ยังไม่มีบัญชีเครดิตของลูกค้า");
      }
      await tx.insert(creditEvents).values({
        branchId, customerId, kind, data, actorId, actorName,
      });
    });
    publishRealtimeInvalidation(branchId);
    return { ok: true };
  }),

  caseFile: managerQuery.input(customerInput).query(async ({ input, ctx }) => {
    const db = getDb();
    const { branchId } = ctx.staff;
    const { customerId } = input;
    return db.transaction(async tx => {
      const [customer] = await tx.select().from(customers).where(eq(customers.id, customerId));
      if (!customer) throw new Error("ไม่พบลูกค้า");
      const asOf = new Date();
      const [account, ledger, documents, events] = await Promise.all([
        readCreditAccount(tx, branchId, customerId),
        readCustomerCredit(tx, branchId, customerId, asOf),
        tx.select({
          id: sales.id,
          receiptNo: sales.receiptNo,
          createdAt: sales.createdAt,
          creditDueOn: sales.creditDueOn,
          creditProof: sales.creditProof,
          total: sales.total,
          transactionType: sales.transactionType,
          originalSaleId: sales.originalSaleId,
          returnReason: sales.returnReason,
          status: sales.status,
        }).from(sales).where(and(
          eq(sales.branchId, branchId), eq(sales.customerId, customerId), eq(sales.paymentMethod, "credit")
        )).orderBy(asc(sales.createdAt), asc(sales.id)),
        tx.select().from(creditEvents).where(and(
          eq(creditEvents.branchId, branchId), eq(creditEvents.customerId, customerId)
        )).orderBy(desc(creditEvents.id)),
      ]);
      return { asOf, customer, account, documents, events, ...ledger };
    }, { isolationLevel: "repeatable read", accessMode: "read only" });
  }),

  receivePayment: managerQuery
    .input(customerInput.extend({
      amount: z.number().positive().max(1_000_000_000),
      method: z.enum(["cash", "qr", "transfer"]).default("cash"),
      staffName: z.string().default(""),
      note: z.string().trim().max(500).optional(),
      saleId: z.number().int().positive().optional(),
      requestId: z.uuid().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { branchId, id: actorId, name: staffName } = ctx.staff;
      const amount = roundSaleMoney(input.amount);
      if (amount <= 0) throw new Error("จำนวนเงินต้องมากกว่า 0");

      const result = await getDb().transaction(async tx => {
        const customer = await lockCreditCustomer(tx, input.customerId);
        if (input.requestId) {
          const [existing] = await tx.select().from(debtPayments).where(and(
            eq(debtPayments.branchId, branchId), eq(debtPayments.requestId, input.requestId)
          ));
          if (existing) {
            if (
              existing.customerId !== input.customerId ||
              existing.amount !== amount ||
              existing.method !== input.method ||
              existing.saleId !== (input.saleId ?? null) ||
              existing.note !== (input.note ?? null)
            ) throw new Error("รหัสคำขอบันทึกชำระนี้ถูกใช้กับข้อมูลอื่นแล้ว");
            return { payment: existing, created: false, customerName: customer.name };
          }
          const [reversed] = await tx.select({ id: creditEvents.id }).from(creditEvents).where(and(
            eq(creditEvents.branchId, branchId),
            eq(creditEvents.kind, "payment_reversed"),
            sql`${creditEvents.data}->'payment'->>'requestId' = ${input.requestId}`
          )).limit(1);
          if (reversed) throw new Error("รายการชำระนี้ถูกกลับรายการแล้ว");
        }
        const ledger = await readCustomerCredit(tx, branchId, input.customerId);
        if (amount > ledger.outstanding) throw new Error("ยอดชำระมากกว่ายอดค้างชำระ");
        if (input.saleId !== undefined) {
          const invoice = ledger.invoices.find(row => row.id === input.saleId);
          if (!invoice || amount > invoice.remaining) {
            throw new Error("ไม่พบบิลที่เลือกหรือยอดชำระเกินยอดคงเหลือของบิลนี้");
          }
        }
        const [openShift] = await tx.select({ id: shifts.id }).from(shifts).where(and(
          eq(shifts.branchId, branchId), eq(shifts.status, "open")
        )).limit(1);
        const [inserted] = await tx.insert(debtPayments).values({
          branchId, paymentNo: await nextDocNo(tx, "debt_payment", branchId),
          customerId: input.customerId, amount, method: input.method, staffName,
          shiftId: openShift?.id, note: input.note, saleId: input.saleId, requestId: input.requestId,
        }).returning();
        return { payment: inserted!, created: true, customerName: customer.name };
      });
      if (result.created) {
        logAudit({
          action: "receive_debt_payment",
          actorId,
          actorName: staffName,
          branchId,
          detail: `รับชำระหนี้ ${result.payment.paymentNo} จาก ${result.customerName} ยอด ${amount.toFixed(2)} บาท`,
          refType: "debt_payment",
          refId: result.payment.id,
        });
      }
      return result.payment;
    }),

  // ยอดบัญชีใช้รายการรับชำระปัจจุบัน ส่วนประวัติเดิมอยู่ในแฟ้มเครดิต
  removePayment: managerQuery
    .input(z.object({ id: z.number().int().positive(), reason: z.string().trim().min(3).max(500).optional() }))
    .mutation(async ({ input, ctx }) => {
      const { branchId, id: actorId, name: actorName } = ctx.staff;
      const reversed = await getDb().transaction(async tx => {
        const condition = and(eq(debtPayments.id, input.id), eq(debtPayments.branchId, branchId));
        const [current] = await tx.select().from(debtPayments).where(condition);
        if (!current) throw new Error("ไม่พบรายการชำระ");
        await lockCreditCustomer(tx, current.customerId);
        const [payment] = await tx.delete(debtPayments).where(condition).returning();
        if (!payment) throw new Error("รายการชำระถูกกลับรายการแล้ว");
        await tx.insert(creditEvents).values({
          branchId, customerId: payment.customerId, kind: "payment_reversed",
          data: {
            notes: input.reason ?? "กลับรายการผ่านหน้าจอเดิม (ไม่ได้ระบุเหตุผล)",
            payment: {
              id: payment.id, paymentNo: payment.paymentNo, amount: payment.amount,
              method: payment.method, receivedAt: payment.createdAt.toISOString(),
              staffName: payment.staffName, saleId: payment.saleId,
              requestId: payment.requestId, note: payment.note,
            },
          },
          actorId, actorName,
        });
        return payment;
      });
      logAudit({
        action: "remove_debt_payment",
        actorId,
        actorName,
        branchId,
        detail: `กลับรายการรับชำระ ${reversed.paymentNo} ยอด ${reversed.amount.toFixed(2)} บาท`,
        refType: "debt_payment",
        refId: reversed.id,
      });
      return { ok: true };
    }),
});
