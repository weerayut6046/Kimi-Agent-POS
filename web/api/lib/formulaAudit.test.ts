import { describe, expect, it } from "vitest";
import { runFormulaAudit, type FormulaAuditData } from "./formulaAudit";

function validData(): FormulaAuditData {
  const now = new Date("2026-08-07T00:00:00.000Z");
  return {
    sales: [
      {
        id: 1,
        receiptNo: "R00001",
        transactionType: "sale",
        originalSaleId: null,
        subtotal: 107.01,
        discount: 7.01,
        vatRate: 7,
        vatAmount: 6.54,
        total: 100,
        paymentMethod: "cash",
        received: 120,
        changeAmt: 20,
        createdAt: now,
      },
    ],
    saleItems: [
      {
        id: 1,
        saleId: 1,
        name: "ทดสอบ",
        qty: 3,
        unitPrice: 35.67,
        amount: 107.01,
      },
    ],
    shifts: [
      {
        id: 1,
        staffName: "พนักงานทดสอบ",
        openedAt: now,
        totalLiters: 10.125,
        totalAmount: 405,
        totalMoneyMeter: 405,
        openingFloat: 500,
        expectedCash: 610,
      },
    ],
    shiftReadings: [
      {
        id: 1,
        shiftId: 1,
        openMeter: 100,
        closeMeter: 110.125,
        openMoney: 1000,
        closeMoney: 1405,
        pricePerLiter: 40,
      },
    ],
    cashSales: [{ shiftId: 1, amount: 100 }],
    cashDebtPayments: [{ shiftId: 1, amount: 20 }],
    shiftExpenses: [{ shiftId: 1, amount: 10 }],
    payrollRecords: [
      {
        id: 1,
        payrollMonth: "2026-08",
        staffId: 3,
        baseAmount: 1000,
        overtimeAmount: 120,
        bonus: 50,
        deduction: 20,
        netAmount: 1150,
        status: "draft",
        paidAt: null,
        createdAt: now,
      },
    ],
    products: [
      {
        id: 1,
        code: "P001",
        name: "สินค้าทดสอบ",
        price: 20,
        cost: 10,
        stockQty: 5,
        createdAt: now,
      },
    ],
    tanks: [
      {
        id: 1,
        name: "ถังทดสอบ",
        capacityLiters: 10_000,
        currentLiters: 5_000,
      },
    ],
  };
}

describe("formula auditor", () => {
  it("does not report consistent calculations", () => {
    expect(runFormulaAudit(validData())).toEqual([]);
  });

  it("reports the exact rules that fail", () => {
    const data = validData();
    data.sales[0]!.total = 101;
    data.shifts[0]!.totalLiters = 10.12;
    data.payrollRecords[0]!.netAmount = 1149;
    data.products[0]!.stockQty = -1;
    data.tanks[0]!.currentLiters = 11_000;

    const issues = runFormulaAudit(data);
    const rules = issues.map(row => row.rule);

    expect(rules).toEqual(
      expect.arrayContaining([
        "sale_total",
        "sale_vat",
        "sale_change",
        "shift_total_liters",
        "payroll_net",
        "product_stock",
        "tank_over_capacity",
      ])
    );
    expect(issues.find(row => row.rule === "sale_total")).toMatchObject({
      actual: 101,
      expected: 100,
      difference: 1,
      severity: "critical",
      refType: "sale",
      refId: 1,
    });
  });
});
