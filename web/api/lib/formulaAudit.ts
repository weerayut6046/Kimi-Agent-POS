export type FormulaAuditSeverity = "critical" | "warning";
export type FormulaAuditCategory = "sales" | "shifts" | "payroll" | "inventory";

export interface FormulaAuditIssue {
  id: string;
  rule: string;
  severity: FormulaAuditSeverity;
  category: FormulaAuditCategory;
  title: string;
  detail: string;
  suggestion: string;
  refType: "sale" | "sale_item" | "shift" | "payroll" | "product" | "tank";
  refId: number;
  reference: string;
  actual: number | null;
  expected: number | null;
  difference: number | null;
  occurredAt: Date | null;
}

export interface FormulaAuditSale {
  id: number;
  receiptNo: string;
  transactionType: "sale" | "return";
  originalSaleId: number | null;
  subtotal: number;
  discount: number;
  vatRate: number;
  vatAmount: number;
  total: number;
  paymentMethod: "cash" | "qr" | "card" | "credit" | "thungngern";
  received: number;
  changeAmt: number;
  createdAt: Date;
}

export interface FormulaAuditSaleItem {
  id: number;
  saleId: number;
  name: string;
  qty: number;
  unitPrice: number;
  amount: number;
}

export interface FormulaAuditShift {
  id: number;
  staffName: string;
  openedAt: Date;
  totalLiters: number;
  totalAmount: number;
  totalMoneyMeter: number;
  openingFloat: number;
  expectedCash: number | null;
}

export interface FormulaAuditShiftReading {
  id: number;
  shiftId: number;
  openMeter: number;
  closeMeter: number | null;
  openMoney: number;
  closeMoney: number | null;
  pricePerLiter: number;
}

export interface FormulaAuditShiftValue {
  shiftId: number | null;
  amount: number;
}

export interface FormulaAuditPayroll {
  id: number;
  payrollMonth: string;
  staffId: number;
  baseAmount: number;
  absenceDeduction: number;
  advanceDeduction: number;
  overtimeAmount: number;
  bonus: number;
  deduction: number;
  netAmount: number;
  status: "draft" | "paid";
  paidAt: Date | null;
  createdAt: Date;
}

export interface FormulaAuditProduct {
  id: number;
  code: string;
  name: string;
  price: number;
  cost: number;
  stockQty: number;
  createdAt: Date;
}

export interface FormulaAuditTank {
  id: number;
  name: string;
  capacityLiters: number;
  currentLiters: number;
}

export interface FormulaAuditData {
  sales: FormulaAuditSale[];
  saleItems: FormulaAuditSaleItem[];
  shifts: FormulaAuditShift[];
  shiftReadings: FormulaAuditShiftReading[];
  cashSales: FormulaAuditShiftValue[];
  cashDebtPayments: FormulaAuditShiftValue[];
  shiftExpenses: FormulaAuditShiftValue[];
  payrollRecords: FormulaAuditPayroll[];
  products: FormulaAuditProduct[];
  tanks: FormulaAuditTank[];
}

export const FORMULA_AUDIT_RULE_COUNT = 26;

const r2 = (value: number) => Math.round(value * 100) / 100;
const r3 = (value: number) => Math.round(value * 1000) / 1000;
const payrollR2 = (value: number) =>
  Math.round((value + Number.EPSILON) * 100) / 100;

function differs(actual: number, expected: number, tolerance: number) {
  return Math.abs(actual - expected) > tolerance + Number.EPSILON;
}

function difference(actual: number, expected: number) {
  return r3(actual - expected);
}

function sumShiftValues(rows: FormulaAuditShiftValue[]) {
  const result = new Map<number, number>();
  for (const row of rows) {
    if (row.shiftId == null) continue;
    result.set(row.shiftId, (result.get(row.shiftId) ?? 0) + row.amount);
  }
  return result;
}

function issue(
  value: Omit<FormulaAuditIssue, "id" | "difference"> & {
    idSuffix?: string;
  }
): FormulaAuditIssue {
  const { idSuffix, ...fields } = value;
  return {
    ...fields,
    id: `${value.rule}:${value.refType}:${value.refId}${idSuffix ? `:${idSuffix}` : ""}`,
    difference:
      value.actual == null || value.expected == null
        ? null
        : difference(value.actual, value.expected),
  };
}

export function runFormulaAudit(data: FormulaAuditData): FormulaAuditIssue[] {
  const issues: FormulaAuditIssue[] = [];
  const itemsBySale = new Map<number, FormulaAuditSaleItem[]>();
  for (const item of data.saleItems) {
    const items = itemsBySale.get(item.saleId) ?? [];
    items.push(item);
    itemsBySale.set(item.saleId, items);
  }

  for (const sale of data.sales) {
    const items = itemsBySale.get(sale.id) ?? [];
    const reference = sale.receiptNo;

    if (items.length === 0) {
      issues.push(
        issue({
          rule: "sale_missing_items",
          severity: "critical",
          category: "sales",
          title: "พบบิลที่ไม่มีรายการสินค้า",
          detail: `บิล ${reference} มีหัวบิล แต่ไม่พบรายการสินค้า`,
          suggestion: "ตรวจสอบการบันทึกบิลและ transaction ที่สร้างรายการสินค้า",
          refType: "sale",
          refId: sale.id,
          reference,
          actual: 0,
          expected: 1,
          occurredAt: sale.createdAt,
        })
      );
    }

    for (const item of items) {
      const expectedAmount = r2(item.qty * item.unitPrice);
      if (!differs(item.amount, expectedAmount, 0.009)) continue;
      issues.push(
        issue({
          rule: "sale_item_amount",
          severity: "critical",
          category: "sales",
          title: "ยอดรายการสินค้าไม่ตรงกับจำนวน × ราคา",
          detail: `${reference} · ${item.name}: ${item.qty} × ${item.unitPrice}`,
          suggestion: "ตรวจสูตรคำนวณยอดต่อรายการและกติกาการปัดเศษเป็นสตางค์",
          refType: "sale_item",
          refId: item.id,
          reference,
          actual: item.amount,
          expected: expectedAmount,
          occurredAt: sale.createdAt,
        })
      );
    }

    const expectedSubtotal = r2(
      items.reduce((sum, item) => sum + item.amount, 0)
    );
    if (items.length > 0 && differs(sale.subtotal, expectedSubtotal, 0.009)) {
      issues.push(
        issue({
          rule: "sale_subtotal",
          severity: "critical",
          category: "sales",
          title: "ยอดก่อนส่วนลดไม่ตรงกับผลรวมรายการ",
          detail: `บิล ${reference} มียอดรวมรายการ ${expectedSubtotal.toFixed(2)} บาท`,
          suggestion: "คำนวณ subtotal ใหม่จากยอดรายการสินค้าทุกบรรทัด",
          refType: "sale",
          refId: sale.id,
          reference,
          actual: sale.subtotal,
          expected: expectedSubtotal,
          occurredAt: sale.createdAt,
        })
      );
    }

    const expectedTotal = r2(sale.subtotal - sale.discount);
    if (differs(sale.total, expectedTotal, 0.009)) {
      issues.push(
        issue({
          rule: "sale_total",
          severity: "critical",
          category: "sales",
          title: "ยอดสุทธิไม่ตรงกับยอดก่อนลด − ส่วนลด",
          detail: `บิล ${reference}: ${sale.subtotal.toFixed(2)} − (${sale.discount.toFixed(2)})`,
          suggestion: "ตรวจ subtotal, ส่วนลด และการคำนวณยอดสุทธิของบิล",
          refType: "sale",
          refId: sale.id,
          reference,
          actual: sale.total,
          expected: expectedTotal,
          occurredAt: sale.createdAt,
        })
      );
    }

    const vatDenominator = 100 + sale.vatRate;
    if (vatDenominator > 0) {
      const expectedVat = r2((sale.total * sale.vatRate) / vatDenominator);
      if (differs(sale.vatAmount, expectedVat, 0.009)) {
        issues.push(
          issue({
            rule: "sale_vat",
            severity: "critical",
            category: "sales",
            title: "ภาษีมูลค่าเพิ่มไม่ตรงกับสูตร VAT รวมใน",
            detail: `บิล ${reference} ใช้อัตรา VAT ${sale.vatRate}%`,
            suggestion: "คำนวณ VAT = ยอดสุทธิ × อัตราภาษี ÷ (100 + อัตราภาษี)",
            refType: "sale",
            refId: sale.id,
            reference,
            actual: sale.vatAmount,
            expected: expectedVat,
            occurredAt: sale.createdAt,
          })
        );
      }
    }

    if (sale.transactionType === "sale" && sale.paymentMethod === "cash") {
      const expectedChange = r2(Math.max(0, sale.received - sale.total));
      if (sale.received + 0.009 < sale.total) {
        issues.push(
          issue({
            rule: "sale_cash_received",
            severity: "critical",
            category: "sales",
            title: "ยอดรับเงินสดน้อยกว่ายอดขาย",
            detail: `บิล ${reference} รับเงินไม่ครบตามยอดสุทธิ`,
            suggestion: "ตรวจยอดรับเงินหรือช่องทางชำระของบิล",
            refType: "sale",
            refId: sale.id,
            reference,
            actual: sale.received,
            expected: sale.total,
            occurredAt: sale.createdAt,
          })
        );
      }
      if (differs(sale.changeAmt, expectedChange, 0.009)) {
        issues.push(
          issue({
            rule: "sale_change",
            severity: "critical",
            category: "sales",
            title: "เงินทอนไม่ตรงกับเงินรับ − ยอดสุทธิ",
            detail: `บิล ${reference} รับ ${sale.received.toFixed(2)} บาท`,
            suggestion: "คำนวณเงินทอนใหม่จากยอดรับเงินจริงและยอดสุทธิ",
            refType: "sale",
            refId: sale.id,
            reference,
            actual: sale.changeAmt,
            expected: expectedChange,
            occurredAt: sale.createdAt,
          })
        );
      }
    } else if (sale.paymentMethod !== "cash") {
      if (differs(sale.received, sale.total, 0.009)) {
        issues.push(
          issue({
            rule: "sale_noncash_received",
            severity: "warning",
            category: "sales",
            title: "ยอดรับแบบไม่ใช่เงินสดไม่ตรงกับยอดสุทธิ",
            detail: `บิล ${reference} ชำระด้วย ${sale.paymentMethod}`,
            suggestion: "ตรวจ snapshot ยอดรับของช่องทางชำระเงิน",
            refType: "sale",
            refId: sale.id,
            reference,
            actual: sale.received,
            expected: sale.total,
            occurredAt: sale.createdAt,
          })
        );
      }
      if (differs(sale.changeAmt, 0, 0.009)) {
        issues.push(
          issue({
            rule: "sale_noncash_change",
            severity: "warning",
            category: "sales",
            title: "บิลไม่ใช่เงินสดแต่มีเงินทอน",
            detail: `บิล ${reference} ชำระด้วย ${sale.paymentMethod}`,
            suggestion: "ตั้งเงินทอนของช่องทางที่ไม่ใช่เงินสดเป็นศูนย์",
            refType: "sale",
            refId: sale.id,
            reference,
            actual: sale.changeAmt,
            expected: 0,
            occurredAt: sale.createdAt,
          })
        );
      }
    }

    const hasWrongSign =
      sale.transactionType === "sale"
        ? sale.subtotal < 0 || sale.total < 0
        : sale.subtotal > 0 || sale.total > 0 || sale.originalSaleId == null;
    if (hasWrongSign) {
      issues.push(
        issue({
          rule: "sale_transaction_sign",
          severity: "critical",
          category: "sales",
          title: "เครื่องหมายยอดเงินไม่สัมพันธ์กับประเภทธุรกรรม",
          detail:
            sale.transactionType === "return"
              ? `รายการคืน ${reference} ต้องมียอดติดลบและอ้างอิงบิลเดิม`
              : `บิลขาย ${reference} ต้องมียอดเป็นศูนย์หรือบวก`,
          suggestion: "ตรวจขั้นตอนสร้างบิลขาย/คืนสินค้าและการใส่เครื่องหมายลบ",
          refType: "sale",
          refId: sale.id,
          reference,
          actual: sale.total,
          expected:
            sale.transactionType === "return"
              ? -Math.abs(sale.total)
              : Math.abs(sale.total),
          occurredAt: sale.createdAt,
        })
      );
    }
  }

  const readingsByShift = new Map<number, FormulaAuditShiftReading[]>();
  for (const reading of data.shiftReadings) {
    const rows = readingsByShift.get(reading.shiftId) ?? [];
    rows.push(reading);
    readingsByShift.set(reading.shiftId, rows);
  }
  const cashSales = sumShiftValues(data.cashSales);
  const cashDebts = sumShiftValues(data.cashDebtPayments);
  const expenses = sumShiftValues(data.shiftExpenses);

  for (const shift of data.shifts) {
    const readings = readingsByShift.get(shift.id) ?? [];
    const reference = `กะ #${shift.id} · ${shift.staffName}`;
    if (readings.length === 0) {
      issues.push(
        issue({
          rule: "shift_missing_readings",
          severity: "warning",
          category: "shifts",
          title: "กะปิดแล้วแต่ไม่พบข้อมูลมิเตอร์",
          detail: reference,
          suggestion: "ตรวจประวัติการเปิด–ปิดกะและข้อมูลหัวจ่าย",
          refType: "shift",
          refId: shift.id,
          reference,
          actual: 0,
          expected: 1,
          occurredAt: shift.openedAt,
        })
      );
    }

    let totalLiters = 0;
    let totalAmount = 0;
    let totalMoney = 0;
    let complete = readings.length > 0;
    for (const reading of readings) {
      if (reading.closeMeter == null) {
        complete = false;
        issues.push(
          issue({
            rule: "shift_incomplete_reading",
            severity: "warning",
            category: "shifts",
            title: "กะปิดแล้วแต่เลขมิเตอร์ยังไม่ครบ",
            detail: `${reference} · มิเตอร์รายการ #${reading.id}`,
            suggestion: "ตรวจเลขปิดมิเตอร์ของหัวจ่ายรายการนี้",
            refType: "shift",
            refId: shift.id,
            reference,
            actual: null,
            expected: reading.openMeter,
            occurredAt: shift.openedAt,
            idSuffix: String(reading.id),
          })
        );
        continue;
      }
      if (reading.closeMeter < reading.openMeter) {
        complete = false;
        issues.push(
          issue({
            rule: "shift_meter_decreased",
            severity: "critical",
            category: "shifts",
            title: "เลขมิเตอร์ปิดน้อยกว่าเลขเปิด",
            detail: `${reference} · มิเตอร์รายการ #${reading.id}`,
            suggestion: "ตรวจการอ่านตัวเลขหรือการเปลี่ยน/รีเซ็ตมิเตอร์",
            refType: "shift",
            refId: shift.id,
            reference,
            actual: reading.closeMeter,
            expected: reading.openMeter,
            occurredAt: shift.openedAt,
            idSuffix: String(reading.id),
          })
        );
        continue;
      }
      const liters = r3(reading.closeMeter - reading.openMeter);
      totalLiters = r3(totalLiters + liters);
      totalAmount = r2(totalAmount + liters * reading.pricePerLiter);

      if (reading.openMoney > 0) {
        if (reading.closeMoney == null) {
          complete = false;
          issues.push(
            issue({
              rule: "shift_incomplete_money_meter",
              severity: "warning",
              category: "shifts",
              title: "กะปิดแล้วแต่เลขมิเตอร์เงินยังไม่ครบ",
              detail: `${reference} · มิเตอร์รายการ #${reading.id}`,
              suggestion: "ตรวจเลขปิดมิเตอร์เงิน (P) ของหัวจ่ายรายการนี้",
              refType: "shift",
              refId: shift.id,
              reference,
              actual: null,
              expected: reading.openMoney,
              occurredAt: shift.openedAt,
              idSuffix: String(reading.id),
            })
          );
        } else if (reading.closeMoney < reading.openMoney) {
          complete = false;
          issues.push(
            issue({
              rule: "shift_money_meter_decreased",
              severity: "critical",
              category: "shifts",
              title: "มิเตอร์เงินปิดน้อยกว่ามิเตอร์เงินเปิด",
              detail: `${reference} · มิเตอร์รายการ #${reading.id}`,
              suggestion: "ตรวจตัวเลข P หรือประวัติการรีเซ็ตมิเตอร์",
              refType: "shift",
              refId: shift.id,
              reference,
              actual: reading.closeMoney,
              expected: reading.openMoney,
              occurredAt: shift.openedAt,
              idSuffix: String(reading.id),
            })
          );
        } else {
          totalMoney = r2(totalMoney + reading.closeMoney - reading.openMoney);
        }
      }
    }

    if (complete) {
      const totals: Array<{
        rule: string;
        title: string;
        actual: number;
        expected: number;
        tolerance: number;
        suggestion: string;
      }> = [
        {
          rule: "shift_total_liters",
          title: "ยอดลิตรรวมของกะไม่ตรงกับมิเตอร์",
          actual: shift.totalLiters,
          expected: totalLiters,
          tolerance: 0.0009,
          suggestion:
            "คำนวณผลต่างมิเตอร์ทุกหัวจ่ายใหม่ด้วยความละเอียด 3 ตำแหน่ง",
        },
        {
          rule: "shift_total_amount",
          title: "ยอดเงินจากลิตรของกะไม่ตรงกับสูตร",
          actual: shift.totalAmount,
          expected: totalAmount,
          tolerance: 0.009,
          suggestion: "คำนวณลิตร × ราคาต่อลิตรใหม่สำหรับทุกหัวจ่าย",
        },
        {
          rule: "shift_total_money_meter",
          title: "ยอดมิเตอร์เงินรวมของกะไม่ตรง",
          actual: shift.totalMoneyMeter,
          expected: totalMoney,
          tolerance: 0.009,
          suggestion: "รวมผลต่างมิเตอร์เงิน (P) ของทุกหัวจ่ายใหม่",
        },
      ];
      for (const total of totals) {
        if (!differs(total.actual, total.expected, total.tolerance)) continue;
        issues.push(
          issue({
            rule: total.rule,
            severity: "critical",
            category: "shifts",
            title: total.title,
            detail: reference,
            suggestion: total.suggestion,
            refType: "shift",
            refId: shift.id,
            reference,
            actual: total.actual,
            expected: total.expected,
            occurredAt: shift.openedAt,
          })
        );
      }
    }

    if (shift.expectedCash != null) {
      const expectedCash = r2(
        shift.openingFloat +
          (cashSales.get(shift.id) ?? 0) +
          (cashDebts.get(shift.id) ?? 0) -
          (expenses.get(shift.id) ?? 0)
      );
      if (differs(shift.expectedCash, expectedCash, 0.009)) {
        issues.push(
          issue({
            rule: "shift_expected_cash",
            severity: "critical",
            category: "shifts",
            title: "เงินสดที่ควรมีของกะไม่ตรงกับรายการเคลื่อนไหว",
            detail: `${reference}: เงินทอนตั้งต้น + ขายเงินสด + รับชำระหนี้ − ค่าใช้จ่าย`,
            suggestion:
              "ตรวจบิลเงินสด รายการรับชำระหนี้ และค่าใช้จ่ายที่ผูกกับกะ",
            refType: "shift",
            refId: shift.id,
            reference,
            actual: shift.expectedCash,
            expected: expectedCash,
            occurredAt: shift.openedAt,
          })
        );
      }
    }
  }

  for (const payroll of data.payrollRecords) {
    const expectedNet = payrollR2(
      payroll.baseAmount +
        payroll.overtimeAmount +
        payroll.bonus -
        payroll.absenceDeduction -
        payroll.advanceDeduction -
        payroll.deduction
    );
    if (differs(payroll.netAmount, expectedNet, 0.009)) {
      issues.push(
        issue({
          rule: "payroll_net",
          severity: "critical",
          category: "payroll",
          title: "เงินเดือนสุทธิไม่ตรงกับสูตร",
          detail: `${payroll.payrollMonth} · พนักงาน #${payroll.staffId}: เงินฐาน + OT + โบนัส − หักขาดงาน − ยอดเบิก − หักอื่น`,
          suggestion: "คำนวณรายการเงินเดือนใหม่ก่อนเปลี่ยนสถานะเป็นจ่ายแล้ว",
          refType: "payroll",
          refId: payroll.id,
          reference: `${payroll.payrollMonth} · พนักงาน #${payroll.staffId}`,
          actual: payroll.netAmount,
          expected: expectedNet,
          occurredAt: payroll.createdAt,
        })
      );
    }
    if (
      (payroll.status === "paid" && payroll.paidAt == null) ||
      (payroll.status === "draft" && payroll.paidAt != null)
    ) {
      issues.push(
        issue({
          rule: "payroll_status_date",
          severity: "warning",
          category: "payroll",
          title: "สถานะเงินเดือนไม่สัมพันธ์กับวันที่จ่าย",
          detail: `${payroll.payrollMonth} · พนักงาน #${payroll.staffId}`,
          suggestion: "ตรวจสถานะจ่ายแล้วและวันที่จ่ายของรายการเงินเดือน",
          refType: "payroll",
          refId: payroll.id,
          reference: `${payroll.payrollMonth} · พนักงาน #${payroll.staffId}`,
          actual: payroll.paidAt == null ? 0 : 1,
          expected: payroll.status === "paid" ? 1 : 0,
          occurredAt: payroll.createdAt,
        })
      );
    }
  }

  for (const product of data.products) {
    const invalid = [
      { field: "ราคาขาย", value: product.price, rule: "product_price" },
      { field: "ต้นทุน", value: product.cost, rule: "product_cost" },
      { field: "สต็อก", value: product.stockQty, rule: "product_stock" },
    ].filter(row => row.value < 0);
    for (const row of invalid) {
      issues.push(
        issue({
          rule: row.rule,
          severity: "critical",
          category: "inventory",
          title: `${row.field}สินค้าเป็นค่าติดลบ`,
          detail: `${product.code} · ${product.name}`,
          suggestion: "ตรวจรายการขาย รับเข้า คืนสินค้า หรือการปรับสต็อกล่าสุด",
          refType: "product",
          refId: product.id,
          reference: product.code,
          actual: row.value,
          expected: 0,
          occurredAt: product.createdAt,
        })
      );
    }
  }

  for (const tank of data.tanks) {
    if (tank.capacityLiters <= 0 || tank.currentLiters < 0) {
      issues.push(
        issue({
          rule: "tank_invalid_liters",
          severity: "critical",
          category: "inventory",
          title: "ค่าปริมาณหรือความจุถังไม่ถูกต้อง",
          detail: tank.name,
          suggestion: "ตรวจความจุถังและรายการปรับยอดน้ำมันล่าสุด",
          refType: "tank",
          refId: tank.id,
          reference: tank.name,
          actual: tank.currentLiters,
          expected: Math.max(0, tank.capacityLiters),
          occurredAt: null,
        })
      );
    } else if (tank.currentLiters > tank.capacityLiters + 0.0009) {
      issues.push(
        issue({
          rule: "tank_over_capacity",
          severity: "warning",
          category: "inventory",
          title: "ปริมาณน้ำมันสูงกว่าความจุถัง",
          detail: tank.name,
          suggestion: "ตรวจรายการเติมถัง ค่าวัดจริง และความจุที่ตั้งไว้",
          refType: "tank",
          refId: tank.id,
          reference: tank.name,
          actual: tank.currentLiters,
          expected: tank.capacityLiters,
          occurredAt: null,
        })
      );
    }
  }

  const severityOrder: Record<FormulaAuditSeverity, number> = {
    critical: 0,
    warning: 1,
  };
  return issues.sort((a, b) => {
    const severity = severityOrder[a.severity] - severityOrder[b.severity];
    if (severity !== 0) return severity;
    return (b.occurredAt?.getTime() ?? 0) - (a.occurredAt?.getTime() ?? 0);
  });
}
