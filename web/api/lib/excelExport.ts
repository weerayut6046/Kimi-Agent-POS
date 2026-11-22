import { fmtDateTH, fmtDateTimeTH } from "./dates";
import type ExcelJS from "exceljs";

/**
 * สร้างไฟล์ Excel (.xlsx) สำหรับรายงาน — คืน Buffer ให้ router แปลง base64 ส่งกลับผ่าน tRPC
 * (pattern เดียวกับ dbadmin.readBackup) — ชื่อ sheet ภาษาไทย, ชื่อไฟล์ ASCII
 */

// label วิธีชำระ (ซ้ำกับ web/src/lib/format.ts โดยตั้งใจ — ฝั่ง API ไม่ import จาก src)
const PAY_LABEL: Record<string, string> = {
  cash: "เงินสด",
  qr: "QR พร้อมเพย์",
  card: "บัตร",
  credit: "เครดิต",
  thungngern: "QR ถุงเงิน",
};
const DEBT_LABEL: Record<string, string> = {
  cash: "เงินสด",
  qr: "QR พร้อมเพย์",
  transfer: "โอน",
};

const LITERS = "#,##0.000";
const MONEY = "#,##0.00";
const INT = "#,##0";

export interface FuelSalesRow {
  name: string;
  liters: number;
  revenue: number;
}

export interface BillRow {
  receiptNo: string;
  createdAt: Date;
  staffName: string;
  paymentMethod: string;
  subtotal: number;
  discount: number;
  vatAmount: number;
  total: number;
  status: string;
}

export interface ShiftRow {
  id: number;
  staffName: string;
  openedAt: Date;
  closedAt: Date | null;
  status: string;
  totalLiters: number;
  totalAmount: number;
  totalMoneyMeter: number;
  posAmount: number;
  openingFloat: number; // เงินทอนเริ่มกะ
  countedCash: number | null; // เงินสดนับได้ตอนปิดกะ
  transferAmount: number | null; // ยอดเงินที่ลูกค้าโอนตอนปิดกะ
  expensesTotal: number; // ค่าใช้จ่ายที่ผูกกับกะ
  countedTotal: number | null; // เงินสดนับ + โอน + POS − ค่าใช้จ่าย
  cashExpected: number; // เงินสดที่ควรมี (snapshot ตอนปิดกะ หรือคำนวณย้อนหลังสำหรับกะเก่า)
  cashDiff: number | null; // ยอดนับได้รวม − ควรมี
  cashDiffP: number | null; // ยอดนับได้รวม − ควรมีเทียบยอด P (null ถ้าไม่มียอด P)
}

export interface ExpenseRow {
  id: number;
  createdAt: Date;
  title: string;
  category: string;
  staffName: string | null;
  amount: number;
}

export interface DebtRow {
  id: number;
  paymentNo: string;
  createdAt: Date;
  customerName: string;
  method: string;
  amount: number;
}

export interface DailyReportData {
  date: string; // YYYY-MM-DD
  totalSales: number;
  billCount: number;
  voidedCount: number;
  voidedTotal: number;
  discountTotal: number;
  vatTotal: number;
  byMethod: Record<
    "cash" | "qr" | "card" | "credit" | "thungngern",
    { count: number; total: number }
  >;
  fuelLiters: { name: string; liters: number }[];
  totalLiters: number;
  fuelSales: FuelSalesRow[];
  shifts: ShiftRow[];
  expenses: { items: ExpenseRow[]; total: number };
  debtPayments: {
    items: DebtRow[];
    total: number;
    byMethod: Record<"cash" | "qr" | "transfer", number>;
  };
  expectedCash: number;
  bills: BillRow[];
}

export interface FuelStockProductRow {
  productId: number;
  code: string;
  name: string;
  openingStock: number;
  receivedLiters: number;
  refillCount: number;
  soldLiters: number;
  revenue: number;
  closingStock: number;
  netMovement: number;
  inventoryTurnover: number;
}

export interface FuelStockPeriodRow {
  key: string;
  label: string;
  start: Date;
  end: Date;
  isPartial: boolean;
  openingStock: number;
  receivedLiters: number;
  refillCount: number;
  soldLiters: number;
  revenue: number;
  closingStock: number;
  netMovement: number;
  inventoryTurnover: number;
  products: FuelStockProductRow[];
}

export interface FuelStockSummaryData {
  view: "monthly" | "yearly";
  year: number;
  generatedAt: Date;
  rangeStart: Date;
  rangeEnd: Date;
  stockMethod: string;
  totals: {
    openingStock: number;
    receivedLiters: number;
    refillCount: number;
    soldLiters: number;
    revenue: number;
    closingStock: number;
    currentStock: number;
    currentCapacity: number;
    netMovement: number;
    inventoryTurnover: number;
    stockCoverageDays: number | null;
    lowTankCount: number;
    topProduct: {
      productId: number;
      name: string;
      soldLiters: number;
    } | null;
  };
  periods: FuelStockPeriodRow[];
  currentProducts: Array<{
    productId: number;
    code: string;
    name: string;
    currentLiters: number;
    capacityLiters: number;
    fillPercent: number;
    lowTankCount: number;
    tankCount: number;
  }>;
}

const PAY_METHODS = ["cash", "qr", "card", "credit", "thungngern"] as const;
const DEBT_METHODS = ["cash", "qr", "transfer"] as const;

// ---------- style helpers ----------
function widths(ws: ExcelJS.Worksheet, ws_widths: number[]) {
  ws_widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));
}

function headerCells(row: ExcelJS.Row) {
  row.eachCell(c => {
    c.font = { bold: true };
    c.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFE5E7EB" },
    };
    c.border = { bottom: { style: "thin" } };
  });
}

function addTable(
  ws: ExcelJS.Worksheet,
  headers: string[],
  rows: (string | number | null)[][],
  moneyCols: number[] = [],
  intCols: number[] = [],
  literCols: number[] = []
) {
  const hr = ws.addRow(headers);
  headerCells(hr);
  for (const r of rows) {
    const row = ws.addRow(r);
    moneyCols.forEach(ci => (row.getCell(ci + 1).numFmt = MONEY));
    literCols.forEach(ci => (row.getCell(ci + 1).numFmt = LITERS));
    intCols.forEach(ci => (row.getCell(ci + 1).numFmt = INT));
  }
}

function sheetFuelSales(wb: ExcelJS.Workbook, fuelSales: FuelSalesRow[]) {
  const ws = wb.addWorksheet("ลิตรและยอดขายน้ำมัน");
  widths(ws, [22, 12, 16]);
  addTable(
    ws,
    ["ชนิดน้ำมัน", "ลิตร", "ยอดขาย (บาท)"],
    fuelSales.map(fuel => [fuel.name, fuel.liters, fuel.revenue]),
    [2],
    [],
    [1]
  );
  if (fuelSales.length > 0) {
    const total = ws.addRow([
      "รวม",
      fuelSales.reduce((sum, fuel) => sum + fuel.liters, 0),
      fuelSales.reduce((sum, fuel) => sum + fuel.revenue, 0),
    ]);
    total.font = { bold: true };
    total.getCell(2).numFmt = LITERS;
    total.getCell(3).numFmt = MONEY;
  }
}

function sheetBills(wb: ExcelJS.Workbook, bills: BillRow[]) {
  const ws = wb.addWorksheet("บิลขาย");
  widths(ws, [16, 20, 16, 14, 14, 12, 12, 14, 12]);
  addTable(
    ws,
    [
      "เลขที่",
      "วันเวลา",
      "พนักงาน",
      "วิธีชำระ",
      "ยอดก่อนลด",
      "ส่วนลด",
      "VAT",
      "ยอดรวม",
      "สถานะ",
    ],
    bills.map(b => [
      b.receiptNo,
      fmtDateTimeTH(b.createdAt),
      b.staffName,
      PAY_LABEL[b.paymentMethod] ?? b.paymentMethod,
      b.subtotal,
      b.discount,
      b.vatAmount,
      b.total,
      b.status === "voided" ? "ยกเลิก" : "สำเร็จ",
    ]),
    [4, 5, 6, 7]
  );
}

async function toBuffer(wb: ExcelJS.Workbook): Promise<Buffer> {
  const out = await wb.xlsx.writeBuffer();
  return Buffer.isBuffer(out) ? out : Buffer.from(out);
}

// ---------- รายงานปิดวัน (1 วัน) ----------
export async function buildDailyWorkbook(
  daily: DailyReportData
): Promise<Buffer> {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  wb.creator = "POS ปั๊มน้ำมัน";

  // สรุป
  const ws = wb.addWorksheet("สรุป");
  widths(ws, [30, 18, 14, 18]);
  const title = ws.addRow([
    `รายงานปิดวัน (Z-Report) — ${fmtDateTH(daily.date)}`,
  ]);
  title.font = { bold: true, size: 14 };
  ws.addRow([]);
  const summary: [string, string | number][] = [
    ["ยอดขายรวม", daily.totalSales],
    ["จำนวนบิล", daily.billCount],
    ["บิลยกเลิก", `${daily.voidedCount} บิล / ${daily.voidedTotal} บาท`],
    ["ส่วนลด", daily.discountTotal],
    ["VAT (รวมใน)", daily.vatTotal],
    ["ลิตรน้ำมันรวม", daily.totalLiters],
    ["ค่าใช้จ่าย", daily.expenses.total],
    ["รับชำระหนี้", daily.debtPayments.total],
    ["เงินสดที่ควรมีในลิ้นชัก", daily.expectedCash],
  ];
  for (const [k, v] of summary) {
    const row = ws.addRow([k, v]);
    row.getCell(1).font = { bold: true };
    if (typeof v === "number")
      row.getCell(2).numFmt =
        k === "จำนวนบิล" ? INT : k === "ลิตรน้ำมันรวม" ? LITERS : MONEY;
  }
  ws.addRow([]);
  ws.addRow(["แยกตามวิธีชำระ"]).font = { bold: true };
  addTable(
    ws,
    ["วิธีชำระ", "จำนวนบิล", "ยอดเงิน"],
    PAY_METHODS.map(m => [
      PAY_LABEL[m],
      daily.byMethod[m].count,
      daily.byMethod[m].total,
    ]),
    [2],
    [1]
  );
  ws.addRow([]);
  ws.addRow(["รับชำระหนี้แยกวิธี"]).font = { bold: true };
  addTable(
    ws,
    ["วิธีชำระ", "ยอดเงิน"],
    DEBT_METHODS.map(m => [DEBT_LABEL[m], daily.debtPayments.byMethod[m]]),
    [1]
  );

  sheetFuelSales(wb, daily.fuelSales);

  // กะการทำงาน
  const wsShift = wb.addWorksheet("กะการทำงาน");
  widths(
    wsShift,
    [8, 18, 20, 20, 12, 12, 16, 14, 14, 12, 14, 14, 12, 14, 14, 14]
  );
  addTable(
    wsShift,
    [
      "กะ",
      "พนักงาน",
      "เปิด",
      "ปิด",
      "สถานะ",
      "ลิตร",
      "ยอดลิตร×ราคา",
      "ยอด P",
      "ยอด POS",
      "เงินทอน",
      "เงินสดควรมี",
      "เงินสดนับได้",
      "ยอดโอน",
      "ยอดนับได้รวม",
      "ต่าง",
      "ต่างเทียบ P",
    ],
    daily.shifts.map(s => [
      `#${s.id}`,
      s.staffName,
      fmtDateTimeTH(s.openedAt),
      s.closedAt ? fmtDateTimeTH(s.closedAt) : "-",
      s.status === "open" ? "กำลังเปิด" : "ปิดแล้ว",
      s.totalLiters,
      s.totalAmount,
      s.totalMoneyMeter,
      s.posAmount,
      s.openingFloat,
      s.cashExpected,
      s.countedCash,
      s.transferAmount,
      s.countedTotal,
      s.cashDiff,
      s.cashDiffP,
    ]),
    [6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    [],
    [5]
  );

  // ค่าใช้จ่าย
  const wsExp = wb.addWorksheet("ค่าใช้จ่าย");
  widths(wsExp, [20, 26, 16, 16, 14]);
  addTable(
    wsExp,
    ["เวลา", "รายการ", "หมวด", "พนักงาน", "จำนวนเงิน"],
    daily.expenses.items.map(e => [
      fmtDateTimeTH(e.createdAt),
      e.title,
      e.category,
      e.staffName || "-",
      e.amount,
    ]),
    [4]
  );

  // ชำระหนี้
  const wsDebt = wb.addWorksheet("ชำระหนี้");
  widths(wsDebt, [14, 20, 24, 14, 14]);
  addTable(
    wsDebt,
    ["เลขที่", "เวลา", "ลูกค้า", "วิธีชำระ", "จำนวนเงิน"],
    daily.debtPayments.items.map(p => [
      p.paymentNo,
      fmtDateTimeTH(p.createdAt),
      p.customerName,
      DEBT_LABEL[p.method] ?? p.method,
      p.amount,
    ]),
    [4]
  );

  sheetBills(wb, daily.bills);
  return toBuffer(wb);
}

// ---------- รายงานช่วงเวลา (หลายวัน) ----------
export async function buildRangeWorkbook(opts: {
  from: string; // YYYY-MM-DD
  to: string;
  days: DailyReportData[];
  fuelSales: FuelSalesRow[];
}): Promise<Buffer> {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  wb.creator = "POS ปั๊มน้ำมัน";

  const ws = wb.addWorksheet("สรุปรายวัน");
  widths(ws, [12, 14, 8, 8, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 14]);
  const title = ws.addRow([
    `รายงานยอดขาย ${fmtDateTH(opts.from)} – ${fmtDateTH(opts.to)}`,
  ]);
  title.font = { bold: true, size: 14 };
  ws.addRow([]);
  addTable(
    ws,
    [
      "วันที่",
      "ยอดขาย",
      "บิล",
      "ยกเลิก",
      "ส่วนลด",
      "VAT",
      "เงินสด",
      "QR",
      "บัตร",
      "เครดิต",
      "ถุงเงิน",
      "ลิตร",
      "ค่าใช้จ่าย",
      "ชำระหนี้",
      "เงินสดคาดหวัง",
    ],
    opts.days.map(d => [
      fmtDateTH(d.date),
      d.totalSales,
      d.billCount,
      d.voidedCount,
      d.discountTotal,
      d.vatTotal,
      d.byMethod.cash.total,
      d.byMethod.qr.total,
      d.byMethod.card.total,
      d.byMethod.credit.total,
      d.byMethod.thungngern.total,
      d.totalLiters,
      d.expenses.total,
      d.debtPayments.total,
      d.expectedCash,
    ]),
    [1, 4, 5, 6, 7, 8, 9, 10, 12, 13, 14],
    [2, 3],
    [11]
  );
  if (opts.days.length > 0) {
    const sum = (f: (d: DailyReportData) => number) =>
      opts.days.reduce((s, d) => s + f(d), 0);
    const tr = ws.addRow([
      "รวม",
      sum(d => d.totalSales),
      sum(d => d.billCount),
      sum(d => d.voidedCount),
      sum(d => d.discountTotal),
      sum(d => d.vatTotal),
      sum(d => d.byMethod.cash.total),
      sum(d => d.byMethod.qr.total),
      sum(d => d.byMethod.card.total),
      sum(d => d.byMethod.credit.total),
      sum(d => d.byMethod.thungngern.total),
      sum(d => d.totalLiters),
      sum(d => d.expenses.total),
      sum(d => d.debtPayments.total),
      sum(d => d.expectedCash),
    ]);
    tr.font = { bold: true };
    tr.getCell(12).numFmt = LITERS;
    [2, 5, 6, 7, 8, 9, 10, 11, 13, 14, 15].forEach(
      ci => (tr.getCell(ci).numFmt = MONEY)
    );
  }

  sheetBills(
    wb,
    opts.days.flatMap(d => d.bills)
  );
  sheetFuelSales(wb, opts.fuelSales);
  return toBuffer(wb);
}

// ---------- สรุปสต๊อกน้ำมันรายเดือน / รายปี ----------
export async function buildFuelStockWorkbook(
  report: FuelStockSummaryData,
  periodKey: string
): Promise<Buffer> {
  const period = report.periods.find(item => item.key === periodKey);
  if (!period) throw new Error("ไม่พบงวดสำหรับสร้างไฟล์สรุปสต๊อกน้ำมัน");
  const currentByProduct = new Map(
    report.currentProducts.map(product => [product.productId, product])
  );
  const products = period.products.filter(product => {
    const current = currentByProduct.get(product.productId);
    return (
      (current?.tankCount ?? 0) > 0 ||
      product.receivedLiters > 0 ||
      product.soldLiters > 0
    );
  });
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  wb.creator = "POS ปั๊มน้ำมัน";
  wb.created = new Date(report.generatedAt);

  const ws = wb.addWorksheet("สรุปสต๊อกน้ำมัน");
  widths(ws, [14, 24, 16, 16, 16, 25]);
  ws.views = [{ state: "frozen", ySplit: 3 }];
  const title = ws.addRow([
    `สรุปยอดสต๊อกน้ำมัน — ${period.label}${period.isPartial ? " (ถึงปัจจุบัน)" : ""}`,
  ]);
  title.font = { bold: true, size: 14 };
  ws.addRow([
    "ขายออก = รวมลิตรจากรายการขาย POS ที่สำเร็จ | ยอดขาย = รวมเงินจากรายการขาย POS ที่สำเร็จ",
  ]).font = { italic: true, color: { argb: "FF6B7280" } };
  addTable(
    ws,
    [
      "รหัส",
      "ชนิดน้ำมัน",
      "รับเข้า (ลิตร)",
      "ขายออก (ลิตร)",
      "ยอดขาย",
      "คงเหลือปัจจุบัน (ลิตร)",
    ],
    products.map(product => [
      product.code,
      product.name,
      product.receivedLiters,
      product.soldLiters,
      product.revenue,
      currentByProduct.get(product.productId)?.currentLiters ?? 0,
    ]),
    [4],
    [],
    [2, 3, 5]
  );
  const total = ws.addRow([
    "",
    "รวมงวด",
    period.receivedLiters,
    period.soldLiters,
    period.revenue,
    "แยกตามชนิด",
  ]);
  total.font = { bold: true };
  for (let column = 3; column <= 5; column += 1) {
    total.getCell(column).numFmt = column === 5 ? MONEY : LITERS;
  }
  ws.autoFilter = {
    from: { row: 3, column: 1 },
    to: { row: 3, column: 6 },
  };

  return toBuffer(wb);
}
