import { and, eq, gte, lt } from "drizzle-orm";
import {
  debtPayments,
  expenses,
  fuelTanks,
  payrollRecords,
  products,
  saleItems,
  sales,
  shiftReadings,
  shifts,
} from "@db/schema";
import { getDb } from "../queries/connection";
import {
  FORMULA_AUDIT_RULE_COUNT,
  runFormulaAudit,
  type FormulaAuditIssue,
} from "./formulaAudit";

const DAY_MS = 86_400_000;
const MAX_PUBLIC_ISSUES = 200;

export type FormulaAuditReport = {
  checkedAt: Date;
  period: { days: number; from: Date; to: Date };
  scanned: {
    sales: number;
    saleItems: number;
    shifts: number;
    shiftReadings: number;
    payrollRecords: number;
    products: number;
    tanks: number;
  };
  issues: FormulaAuditIssue[];
};

/**
 * Loads branch-scoped data and runs the deterministic audit rules. This is
 * shared by the regular report and the AI explanation endpoint so the model
 * always analyzes a fresh, server-generated result.
 */
export async function loadFormulaAuditReport(
  branchId: number,
  days: number
): Promise<FormulaAuditReport> {
  const db = getDb();
  const checkedAt = new Date();
  const rangeStart = new Date(checkedAt.getTime() - days * DAY_MS);
  const branchWindow = and(
    eq(sales.branchId, branchId),
    gte(sales.createdAt, rangeStart),
    lt(sales.createdAt, checkedAt)
  );
  const shiftWindow = and(
    eq(shifts.branchId, branchId),
    eq(shifts.status, "closed"),
    gte(shifts.openedAt, rangeStart),
    lt(shifts.openedAt, checkedAt)
  );

  const [
    saleRows,
    itemRows,
    shiftRows,
    readingRows,
    cashSaleRows,
    cashDebtRows,
    expenseRows,
    payrollRows,
    productRows,
    tankRows,
  ] = await Promise.all([
    db
      .select({
        id: sales.id,
        receiptNo: sales.receiptNo,
        transactionType: sales.transactionType,
        originalSaleId: sales.originalSaleId,
        subtotal: sales.subtotal,
        discount: sales.discount,
        vatRate: sales.vatRate,
        vatAmount: sales.vatAmount,
        total: sales.total,
        paymentMethod: sales.paymentMethod,
        received: sales.received,
        changeAmt: sales.changeAmt,
        createdAt: sales.createdAt,
      })
      .from(sales)
      .where(branchWindow),
    db
      .select({
        id: saleItems.id,
        saleId: saleItems.saleId,
        name: saleItems.name,
        qty: saleItems.qty,
        unitPrice: saleItems.unitPrice,
        amount: saleItems.amount,
      })
      .from(saleItems)
      .innerJoin(
        sales,
        and(
          eq(sales.id, saleItems.saleId),
          eq(sales.branchId, saleItems.branchId)
        )
      )
      .where(
        and(
          eq(saleItems.branchId, branchId),
          gte(sales.createdAt, rangeStart),
          lt(sales.createdAt, checkedAt)
        )
      ),
    db
      .select({
        id: shifts.id,
        staffName: shifts.staffName,
        openedAt: shifts.openedAt,
        totalLiters: shifts.totalLiters,
        totalAmount: shifts.totalAmount,
        totalMoneyMeter: shifts.totalMoneyMeter,
        openingFloat: shifts.openingFloat,
        expectedCash: shifts.expectedCash,
      })
      .from(shifts)
      .where(shiftWindow),
    db
      .select({
        id: shiftReadings.id,
        shiftId: shiftReadings.shiftId,
        openMeter: shiftReadings.openMeter,
        closeMeter: shiftReadings.closeMeter,
        openMoney: shiftReadings.openMoney,
        closeMoney: shiftReadings.closeMoney,
        pricePerLiter: shiftReadings.pricePerLiter,
      })
      .from(shiftReadings)
      .innerJoin(
        shifts,
        and(
          eq(shifts.id, shiftReadings.shiftId),
          eq(shifts.branchId, shiftReadings.branchId)
        )
      )
      .where(and(eq(shiftReadings.branchId, branchId), shiftWindow)),
    db
      .select({ shiftId: sales.shiftId, amount: sales.total })
      .from(sales)
      .innerJoin(
        shifts,
        and(eq(shifts.id, sales.shiftId), eq(shifts.branchId, sales.branchId))
      )
      .where(
        and(
          eq(sales.branchId, branchId),
          eq(sales.status, "completed"),
          eq(sales.paymentMethod, "cash"),
          shiftWindow
        )
      ),
    db
      .select({
        shiftId: debtPayments.shiftId,
        amount: debtPayments.amount,
      })
      .from(debtPayments)
      .innerJoin(
        shifts,
        and(
          eq(shifts.id, debtPayments.shiftId),
          eq(shifts.branchId, debtPayments.branchId)
        )
      )
      .where(
        and(
          eq(debtPayments.branchId, branchId),
          eq(debtPayments.method, "cash"),
          shiftWindow
        )
      ),
    db
      .select({ shiftId: expenses.shiftId, amount: expenses.amount })
      .from(expenses)
      .innerJoin(
        shifts,
        and(
          eq(shifts.id, expenses.shiftId),
          eq(shifts.branchId, expenses.branchId)
        )
      )
      .where(and(eq(expenses.branchId, branchId), shiftWindow)),
    db
      .select({
        id: payrollRecords.id,
        payrollMonth: payrollRecords.payrollMonth,
        staffId: payrollRecords.staffId,
        baseAmount: payrollRecords.baseAmount,
        overtimeAmount: payrollRecords.overtimeAmount,
        bonus: payrollRecords.bonus,
        deduction: payrollRecords.deduction,
        netAmount: payrollRecords.netAmount,
        status: payrollRecords.status,
        paidAt: payrollRecords.paidAt,
        createdAt: payrollRecords.createdAt,
      })
      .from(payrollRecords)
      .where(
        and(
          eq(payrollRecords.branchId, branchId),
          gte(payrollRecords.createdAt, rangeStart),
          lt(payrollRecords.createdAt, checkedAt)
        )
      ),
    db
      .select({
        id: products.id,
        code: products.code,
        name: products.name,
        price: products.price,
        cost: products.cost,
        stockQty: products.stockQty,
        createdAt: products.createdAt,
      })
      .from(products)
      .where(eq(products.branchId, branchId)),
    db
      .select({
        id: fuelTanks.id,
        name: fuelTanks.name,
        capacityLiters: fuelTanks.capacityLiters,
        currentLiters: fuelTanks.currentLiters,
      })
      .from(fuelTanks)
      .where(eq(fuelTanks.branchId, branchId)),
  ]);

  return {
    checkedAt,
    period: { days, from: rangeStart, to: checkedAt },
    scanned: {
      sales: saleRows.length,
      saleItems: itemRows.length,
      shifts: shiftRows.length,
      shiftReadings: readingRows.length,
      payrollRecords: payrollRows.length,
      products: productRows.length,
      tanks: tankRows.length,
    },
    issues: runFormulaAudit({
      sales: saleRows,
      saleItems: itemRows,
      shifts: shiftRows,
      shiftReadings: readingRows,
      cashSales: cashSaleRows,
      cashDebtPayments: cashDebtRows,
      shiftExpenses: expenseRows,
      payrollRecords: payrollRows,
      products: productRows,
      tanks: tankRows,
    }),
  };
}

export function presentFormulaAuditReport(report: FormulaAuditReport) {
  const critical = report.issues.filter(
    issue => issue.severity === "critical"
  ).length;
  const warning = report.issues.length - critical;
  const categories = (["sales", "shifts", "payroll", "inventory"] as const).map(
    category => ({
      category,
      issues: report.issues.filter(issue => issue.category === category).length,
    })
  );

  return {
    status: critical > 0 ? "critical" : warning > 0 ? "warning" : "healthy",
    checkedAt: report.checkedAt,
    period: report.period,
    ruleCount: FORMULA_AUDIT_RULE_COUNT,
    scanned: report.scanned,
    counts: { total: report.issues.length, critical, warning },
    categories,
    issues: report.issues.slice(0, MAX_PUBLIC_ISSUES),
    truncated: report.issues.length > MAX_PUBLIC_ISSUES,
  } as const;
}
