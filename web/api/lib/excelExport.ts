import ExcelJS from "exceljs";

/**
 * สร้างไฟล์ Excel (.xlsx) สำหรับรายงาน — คืน Buffer ให้ router แปลง base64 ส่งกลับผ่าน tRPC
 * (pattern เดียวกับ dbadmin.readBackup) — ชื่อ sheet ภาษาไทย, ชื่อไฟล์ ASCII
 */

// label วิธีชำระ (ซ้ำกับ web/src/lib/format.ts โดยตั้งใจ — ฝั่ง API ไม่ import จาก src)
const PAY_LABEL: Record<string, string> = { cash: "เงินสด", qr: "QR พร้อมเพย์", card: "บัตร", credit: "เครดิต" };
const DEBT_LABEL: Record<string, string> = { cash: "เงินสด", qr: "QR พร้อมเพย์", transfer: "โอน" };

const MONEY = "#,##0.00";
const INT = "#,##0";

// วันที่แบบเอกสารไทย (พ.ศ.) — เขียนเป็นข้อความลงเซลล์ กันปัญหา locale ของ Excel
function fmtDateTH(d: Date | string) {
  const dt = new Date(d);
  const dd = String(dt.getDate()).padStart(2, "0");
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${dt.getFullYear() + 543}`;
}
function fmtDateTimeTH(d: Date | string) {
  const dt = new Date(d);
  const hh = String(dt.getHours()).padStart(2, "0");
  const mi = String(dt.getMinutes()).padStart(2, "0");
  const ss = String(dt.getSeconds()).padStart(2, "0");
  return `${fmtDateTH(dt)} ${hh}:${mi}:${ss}`;
}

/** "YYYY-MM-DD" → Date เที่ยงคืน local (ห้าม new Date(s) ตรงๆ เพราะ parse เป็น UTC วันอาจเพี้ยน) */
function dayDate(s: string) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
}

export interface FuelProfitRow {
  name: string;
  liters: number;
  revenue: number;
  costPerLiter: number; // ต้นทุน/ลิตร จาก products.cost ปัจจุบัน (0 = ยังไม่ได้ตั้งต้นทุน)
  profitPerLiter: number;
  profitTotal: number;
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
  cashExpected: number; // เงินสดที่ควรมี (snapshot ตอนปิดกะ หรือคำนวณย้อนหลังสำหรับกะเก่า)
  cashDiff: number | null; // นับได้ − ควรมี
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
  byMethod: Record<"cash" | "qr" | "card" | "credit", { count: number; total: number }>;
  fuelLiters: { name: string; liters: number }[];
  totalLiters: number;
  fuelProfit: FuelProfitRow[];
  shifts: ShiftRow[];
  expenses: { items: ExpenseRow[]; total: number };
  debtPayments: { items: DebtRow[]; total: number; byMethod: Record<"cash" | "qr" | "transfer", number> };
  expectedCash: number;
  bills: BillRow[];
}

const PAY_METHODS = ["cash", "qr", "card", "credit"] as const;
const DEBT_METHODS = ["cash", "qr", "transfer"] as const;

// ---------- style helpers ----------
function widths(ws: ExcelJS.Worksheet, ws_widths: number[]) {
  ws_widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));
}

function headerCells(row: ExcelJS.Row) {
  row.eachCell((c) => {
    c.font = { bold: true };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5E7EB" } };
    c.border = { bottom: { style: "thin" } };
  });
}

function addTable(ws: ExcelJS.Worksheet, headers: string[], rows: (string | number | null)[][], moneyCols: number[] = [], intCols: number[] = []) {
  const hr = ws.addRow(headers);
  headerCells(hr);
  for (const r of rows) {
    const row = ws.addRow(r);
    moneyCols.forEach((ci) => (row.getCell(ci + 1).numFmt = MONEY));
    intCols.forEach((ci) => (row.getCell(ci + 1).numFmt = INT));
  }
}

function sheetFuelProfit(wb: ExcelJS.Workbook, profit: FuelProfitRow[]) {
  const ws = wb.addWorksheet("ลิตรและกำไรน้ำมัน");
  widths(ws, [22, 12, 14, 14, 14, 14]);
  ws.addRow(["กำไรคำนวณจากต้นทุนสินค้าปัจจุบัน (โดยประมาณ) — ต้นทุน/ลิตร = 0 คือยังไม่ได้ตั้งต้นทุนในข้อมูลสินค้า"]).font = { italic: true, color: { argb: "FF6B7280" } };
  ws.addRow([]);
  addTable(
    ws,
    ["ชนิดน้ำมัน", "ลิตร", "ยอดขาย (บาท)", "ต้นทุน/ลิตร", "กำไร/ลิตร", "กำไรรวม (บาท)"],
    profit.map((p) => [p.name, p.liters, p.revenue, p.costPerLiter, p.profitPerLiter, p.profitTotal]),
    [1, 2, 3, 4, 5],
  );
  if (profit.length > 0) {
    const tr = ws.addRow([
      "รวม",
      profit.reduce((s, p) => s + p.liters, 0),
      profit.reduce((s, p) => s + p.revenue, 0),
      null,
      null,
      profit.reduce((s, p) => s + p.profitTotal, 0),
    ]);
    tr.font = { bold: true };
    [2, 3, 4, 5, 6].forEach((ci) => (tr.getCell(ci).numFmt = MONEY));
  }
}

function sheetBills(wb: ExcelJS.Workbook, bills: BillRow[]) {
  const ws = wb.addWorksheet("บิลขาย");
  widths(ws, [16, 20, 16, 14, 14, 12, 12, 14, 12]);
  addTable(
    ws,
    ["เลขที่", "วันเวลา", "พนักงาน", "วิธีชำระ", "ยอดก่อนลด", "ส่วนลด", "VAT", "ยอดรวม", "สถานะ"],
    bills.map((b) => [
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
    [4, 5, 6, 7],
  );
}

async function toBuffer(wb: ExcelJS.Workbook): Promise<Buffer> {
  const out = await wb.xlsx.writeBuffer();
  return Buffer.isBuffer(out) ? out : Buffer.from(out);
}

// ---------- รายงานปิดวัน (1 วัน) ----------
export async function buildDailyWorkbook(daily: DailyReportData): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "POS ปั๊มน้ำมัน";

  // สรุป
  const ws = wb.addWorksheet("สรุป");
  widths(ws, [30, 18, 14, 18]);
  const title = ws.addRow([`รายงานปิดวัน (Z-Report) — ${fmtDateTH(dayDate(daily.date))}`]);
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
    if (typeof v === "number") row.getCell(2).numFmt = k === "จำนวนบิล" ? INT : MONEY;
  }
  ws.addRow([]);
  ws.addRow(["แยกตามวิธีชำระ"]).font = { bold: true };
  addTable(
    ws,
    ["วิธีชำระ", "จำนวนบิล", "ยอดเงิน"],
    PAY_METHODS.map((m) => [PAY_LABEL[m], daily.byMethod[m].count, daily.byMethod[m].total]),
    [2],
    [1],
  );
  ws.addRow([]);
  ws.addRow(["รับชำระหนี้แยกวิธี"]).font = { bold: true };
  addTable(
    ws,
    ["วิธีชำระ", "ยอดเงิน"],
    DEBT_METHODS.map((m) => [DEBT_LABEL[m], daily.debtPayments.byMethod[m]]),
    [1],
  );

  sheetFuelProfit(wb, daily.fuelProfit);

  // กะการทำงาน
  const wsShift = wb.addWorksheet("กะการทำงาน");
  widths(wsShift, [8, 18, 20, 20, 12, 12, 16, 14, 14, 12, 14, 14, 12]);
  addTable(
    wsShift,
    ["กะ", "พนักงาน", "เปิด", "ปิด", "สถานะ", "ลิตร", "ยอดลิตร×ราคา", "ยอด P", "ยอด POS", "เงินทอน", "เงินสดควรมี", "นับได้", "ต่าง"],
    daily.shifts.map((s) => [
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
      s.cashDiff,
    ]),
    [5, 6, 7, 8, 9, 10, 11, 12],
  );

  // ค่าใช้จ่าย
  const wsExp = wb.addWorksheet("ค่าใช้จ่าย");
  widths(wsExp, [20, 26, 16, 16, 14]);
  addTable(
    wsExp,
    ["เวลา", "รายการ", "หมวด", "พนักงาน", "จำนวนเงิน"],
    daily.expenses.items.map((e) => [fmtDateTimeTH(e.createdAt), e.title, e.category, e.staffName || "-", e.amount]),
    [4],
  );

  // ชำระหนี้
  const wsDebt = wb.addWorksheet("ชำระหนี้");
  widths(wsDebt, [14, 20, 24, 14, 14]);
  addTable(
    wsDebt,
    ["เลขที่", "เวลา", "ลูกค้า", "วิธีชำระ", "จำนวนเงิน"],
    daily.debtPayments.items.map((p) => [
      p.paymentNo,
      fmtDateTimeTH(p.createdAt),
      p.customerName,
      DEBT_LABEL[p.method] ?? p.method,
      p.amount,
    ]),
    [4],
  );

  sheetBills(wb, daily.bills);
  return toBuffer(wb);
}

// ---------- รายงานช่วงเวลา (หลายวัน) ----------
export async function buildRangeWorkbook(opts: {
  from: string; // YYYY-MM-DD
  to: string;
  days: DailyReportData[];
  profit: FuelProfitRow[];
}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "POS ปั๊มน้ำมัน";

  const ws = wb.addWorksheet("สรุปรายวัน");
  widths(ws, [12, 14, 8, 8, 12, 12, 12, 12, 12, 12, 12, 12, 12, 14]);
  const title = ws.addRow([`รายงานยอดขาย ${fmtDateTH(dayDate(opts.from))} – ${fmtDateTH(dayDate(opts.to))}`]);
  title.font = { bold: true, size: 14 };
  ws.addRow([]);
  addTable(
    ws,
    ["วันที่", "ยอดขาย", "บิล", "ยกเลิก", "ส่วนลด", "VAT", "เงินสด", "QR", "บัตร", "เครดิต", "ลิตร", "ค่าใช้จ่าย", "ชำระหนี้", "เงินสดคาดหวัง"],
    opts.days.map((d) => [
      fmtDateTH(dayDate(d.date)),
      d.totalSales,
      d.billCount,
      d.voidedCount,
      d.discountTotal,
      d.vatTotal,
      d.byMethod.cash.total,
      d.byMethod.qr.total,
      d.byMethod.card.total,
      d.byMethod.credit.total,
      d.totalLiters,
      d.expenses.total,
      d.debtPayments.total,
      d.expectedCash,
    ]),
    [1, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    [2, 3],
  );
  if (opts.days.length > 0) {
    const sum = (f: (d: DailyReportData) => number) => opts.days.reduce((s, d) => s + f(d), 0);
    const tr = ws.addRow([
      "รวม",
      sum((d) => d.totalSales),
      sum((d) => d.billCount),
      sum((d) => d.voidedCount),
      sum((d) => d.discountTotal),
      sum((d) => d.vatTotal),
      sum((d) => d.byMethod.cash.total),
      sum((d) => d.byMethod.qr.total),
      sum((d) => d.byMethod.card.total),
      sum((d) => d.byMethod.credit.total),
      sum((d) => d.totalLiters),
      sum((d) => d.expenses.total),
      sum((d) => d.debtPayments.total),
      sum((d) => d.expectedCash),
    ]);
    tr.font = { bold: true };
    [2, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14].forEach((ci) => (tr.getCell(ci).numFmt = MONEY));
  }

  sheetBills(
    wb,
    opts.days.flatMap((d) => d.bills),
  );
  sheetFuelProfit(wb, opts.profit);
  return toBuffer(wb);
}
