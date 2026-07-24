import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import {
  buildDailyWorkbook,
  buildRangeWorkbook,
  type DailyReportData,
} from "./excelExport.edge";

const daily: DailyReportData = {
  date: "2026-07-24",
  totalSales: 1200,
  billCount: 1,
  voidedCount: 0,
  voidedTotal: 0,
  discountTotal: 0,
  vatTotal: 78.5,
  byMethod: {
    cash: { count: 1, total: 1200 },
    qr: { count: 0, total: 0 },
    card: { count: 0, total: 0 },
    credit: { count: 0, total: 0 },
  },
  fuelLiters: [{ name: "แก๊สโซฮอล์ 95", liters: 30 }],
  totalLiters: 30,
  fuelProfit: [
    {
      name: "แก๊สโซฮอล์ 95",
      liters: 30,
      revenue: 1200,
      costPerLiter: 38,
      profitPerLiter: 2,
      profitTotal: 60,
    },
  ],
  shifts: [],
  expenses: { items: [], total: 0 },
  debtPayments: {
    items: [],
    total: 0,
    byMethod: { cash: 0, qr: 0, transfer: 0 },
  },
  expectedCash: 1200,
  bills: [
    {
      receiptNo: "INV-001",
      createdAt: new Date("2026-07-24T10:00:00+07:00"),
      staffName: "เจ้าของปั๊ม",
      paymentMethod: "cash",
      subtotal: 1200,
      discount: 0,
      vatAmount: 78.5,
      total: 1200,
      status: "completed",
    },
  ],
};

async function loadWorkbook(buffer: Buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    buffer as unknown as Parameters<typeof workbook.xlsx.load>[0],
  );
  return workbook;
}

describe("Supabase Edge Excel export", () => {
  it("creates a valid daily XLSX with Thai worksheet names", async () => {
    const buffer = await buildDailyWorkbook(daily);
    expect(buffer.subarray(0, 2).toString("latin1")).toBe("PK");

    const workbook = await loadWorkbook(buffer);
    expect(workbook.worksheets.map(sheet => sheet.name)).toEqual([
      "สรุป",
      "ลิตรและกำไรน้ำมัน",
      "กะการทำงาน",
      "ค่าใช้จ่าย",
      "ชำระหนี้",
      "บิลขาย",
    ]);
    expect(
      workbook.getWorksheet("บิลขาย")?.getRow(2).getCell(3).value,
    ).toBe("เจ้าของปั๊ม");
  });

  it("keeps the existing range workbook layout", async () => {
    const buffer = await buildRangeWorkbook({
      from: daily.date,
      to: daily.date,
      days: [daily],
      profit: daily.fuelProfit,
    });
    const workbook = await loadWorkbook(buffer);
    expect(workbook.worksheets.map(sheet => sheet.name)).toEqual([
      "สรุปรายวัน",
      "บิลขาย",
      "ลิตรและกำไรน้ำมัน",
    ]);
    expect(workbook.getWorksheet("สรุปรายวัน")?.rowCount).toBe(5);
  });
});
