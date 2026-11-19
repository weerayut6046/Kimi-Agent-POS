import { and, asc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { creditAccounts, customers, debtPayments, sales } from "@db/schema";
import { bangkokDateKey } from "@contracts/promotion";
import { creditDueOn, type CreditStatus } from "@contracts/credit";
import { roundSaleMoney } from "@contracts/saleItemValues";
import type { getDb } from "../queries/connection";

type Db = ReturnType<typeof getDb>;
type CreditTx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type CreditDb = Db | CreditTx;
type Account = typeof creditAccounts.$inferSelect;
type LedgerSale = Pick<
  typeof sales.$inferSelect,
  "id" | "transactionType" | "originalSaleId" | "total" | "creditDueOn"
>;
type LedgerPayment = Pick<typeof debtPayments.$inferSelect, "amount" | "saleId">;

const toMillis = (value: number) => Math.round(value * 1000);
const toBaht = (value: number) => roundSaleMoney(value / 1000);

/** ล็อกแถวลูกค้าเดียวกันก่อนคำนวณวงเงินหรือเปลี่ยนยอดเครดิต */
export async function lockCreditCustomer(tx: CreditTx, customerId: number) {
  const [customer] = await tx
    .select()
    .from(customers)
    .where(eq(customers.id, customerId))
    .for("update");
  if (!customer) {
    throw new TRPCError({ code: "NOT_FOUND", message: "ไม่พบลูกค้า" });
  }
  return customer;
}

export async function readCreditAccount(
  db: CreditDb,
  branchId: number,
  customerId: number
) {
  const [account] = await db
    .select()
    .from(creditAccounts)
    .where(
      and(
        eq(creditAccounts.branchId, branchId),
        eq(creditAccounts.customerId, customerId)
      )
    );
  return account;
}

export async function readCreditLedgerRows(
  db: CreditDb,
  branchId: number,
  customerId?: number
) {
  const [creditSales, payments] = await Promise.all([
    db
      .select({
        id: sales.id,
        customerId: sales.customerId,
        receiptNo: sales.receiptNo,
        total: sales.total,
        staffName: sales.staffName,
        createdAt: sales.createdAt,
        transactionType: sales.transactionType,
        originalSaleId: sales.originalSaleId,
        creditDueOn: sales.creditDueOn,
      })
      .from(sales)
      .where(
        and(
          eq(sales.branchId, branchId),
          eq(sales.paymentMethod, "credit"),
          eq(sales.status, "completed"),
          customerId === undefined ? undefined : eq(sales.customerId, customerId)
        )
      )
      .orderBy(asc(sales.createdAt), asc(sales.id)),
    db
      .select()
      .from(debtPayments)
      .where(
        and(
          eq(debtPayments.branchId, branchId),
          customerId === undefined
            ? undefined
            : eq(debtPayments.customerId, customerId)
        )
      ),
  ]);
  return { creditSales, payments };
}

/** ใบลดหนี้และเงินที่ระบุเลขบิลลงบิลนั้น ยอดที่ไม่ได้ระบุจัดสรรตามวันขายเก่าก่อน */
export function calculateCreditLedger<T extends LedgerSale>(
  orderedSales: readonly T[],
  payments: readonly LedgerPayment[],
  today: string
) {
  const remaining = new Map<number, number>();
  for (const sale of orderedSales) {
    if (sale.transactionType === "sale" && sale.total >= 0) {
      remaining.set(sale.id, toMillis(sale.total));
    }
  }
  let unallocated = 0;
  const allocate = (id: number | null, amount: number) => {
    const balance = id == null ? 0 : (remaining.get(id) ?? 0);
    const applied = Math.min(balance, amount);
    if (id != null && remaining.has(id)) remaining.set(id, balance - applied);
    unallocated += amount - applied;
  };
  for (const sale of orderedSales) {
    if (sale.total < 0) allocate(sale.originalSaleId, toMillis(-sale.total));
  }
  for (const payment of payments) allocate(payment.saleId, toMillis(payment.amount));

  let open = 0;
  let overdue = 0;
  let unknownDue = 0;
  const invoices = orderedSales.flatMap(sale => {
    const balance = remaining.get(sale.id);
    if (balance === undefined) return [];
    const applied = Math.min(balance, unallocated);
    unallocated -= applied;
    const unpaid = balance - applied;
    const isOverdue =
      unpaid > 0 && sale.creditDueOn !== null && sale.creditDueOn < today;
    open += unpaid;
    if (isOverdue) overdue += unpaid;
    if (!sale.creditDueOn) unknownDue += unpaid;
    return [{ ...sale, remaining: toBaht(unpaid), isOverdue }];
  });
  return {
    invoices,
    outstanding: toBaht(open - unallocated),
    overdue: toBaht(overdue),
    unknownDue: toBaht(unknownDue),
  };
}

export function creditCheckoutState(
  account: Account | undefined,
  legacyLimit: number,
  ledger: { outstanding: number; overdue: number },
  soldAt: Date
) {
  const status: CreditStatus = account?.status ?? "unapproved";
  const terms = status === "approved" ? account?.terms : null;
  const limit = terms?.limit ?? (status === "legacy" && legacyLimit > 0 ? legacyLimit : null);
  const blockedReason =
    status === "unapproved"
      ? "ลูกค้ายังไม่ได้รับอนุมัติเครดิตในสาขานี้"
      : status === "suspended"
        ? "บัญชีนี้ถูกพักเครดิต กรุณาติดต่อผู้จัดการ"
        : ledger.overdue > 0
          ? "ลูกค้ามียอดเกินกำหนด กรุณาตรวจสอบหรือรับชำระก่อนขายเชื่อ"
          : null;
  return {
    status,
    limit,
    outstanding: ledger.outstanding,
    overdue: ledger.overdue,
    blockedReason,
    dueOn: terms ? creditDueOn(soldAt, terms.days) : null,
    requiresDeliveryRef: terms != null,
  };
}

export async function readCustomerCredit(
  db: CreditDb,
  branchId: number,
  customerId: number,
  now = new Date()
) {
  const rows = await readCreditLedgerRows(db, branchId, customerId);
  const ledger = calculateCreditLedger(rows.creditSales, rows.payments, bangkokDateKey(now));
  return { ...rows, ...ledger };
}
