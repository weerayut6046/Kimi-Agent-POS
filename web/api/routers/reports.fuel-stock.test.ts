import { afterAll, beforeAll, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { and, eq } from "drizzle-orm";
import { fuelTanks, products } from "@db/schema";
import { setupTestDb, type TestDb } from "../test/testDb";

let test: TestDb;

function bangkokYearMonth() {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const year = Number(parts.find(part => part.type === "year")?.value);
  const month = parts.find(part => part.type === "month")?.value ?? "01";
  return { year, key: `${year}-${month}` };
}

beforeAll(async () => {
  test = await setupTestDb();
});

afterAll(() => test.cleanup());

describe("reports.fuelStockSummary", () => {
  it("สรุปรับเข้า ขายออก ยอดขาย และคงเหลือตามชนิดน้ำมัน", async () => {
    const gsh95 = await test.db.query.products.findFirst({
      where: and(eq(products.branchId, 1), eq(products.code, "GSH95")),
    });
    if (!gsh95) throw new Error("ไม่พบ GSH95");
    const tank = await test.db.query.fuelTanks.findFirst({
      where: and(eq(fuelTanks.branchId, 1), eq(fuelTanks.productId, gsh95.id)),
    });
    if (!tank) throw new Error("ไม่พบถัง GSH95");

    await test.caller("manager").catalog.refillTank({
      tankId: tank.id,
      liters: 100,
      costPerLiter: 38,
      note: "รับเข้าทดสอบรายงาน",
    });
    await test.caller().pos.createSale({
      items: [{ productId: gsh95.id, qty: 10 }],
      paymentMethod: "qr",
    });
    const nozzles = await test.db.query.nozzles.findMany();
    const nozzle = nozzles.find(n => n.tankId === tank.id)!;
    const { shiftId } = await test.caller().pos.openShift({
      staffName: "รายงาน",
      readings: nozzles.map(n => ({
        nozzleId: n.id,
        openMeter: n.currentMeter,
        openMoney: n.currentMoney,
      })),
    });
    await test.caller().pos.closeShift({
      shiftId,
      readings: nozzles.map(n => ({
        nozzleId: n.id,
        closeMeter: n.currentMeter + (n.id === nozzle.id ? 10 : 0),
        closeMoney: n.currentMoney + (n.id === nozzle.id ? 407.4 : 0),
      })),
    });

    const { year, key } = bangkokYearMonth();
    const report = await test
      .caller("manager")
      .reports.fuelStockSummary({ view: "monthly", year });
    const currentMonth = report.periods.find(period => period.key === key);
    expect(currentMonth).toBeTruthy();
    const row = currentMonth!.products.find(
      product => product.productId === gsh95.id
    );

    expect(row).toMatchObject({
      receivedLiters: 100,
      refillCount: 1,
      soldLiters: 10,
      revenue: 407.4,
      openingStock: tank.currentLiters,
      closingStock: tank.currentLiters + 90,
    });
    expect(row).not.toHaveProperty("stockProfit");
    expect(row).not.toHaveProperty("avgPurchaseCost");
    expect(report.totals.receivedLiters).toBe(100);
    expect(report.totals.soldLiters).toBe(10);
    expect(report.totals.topProduct?.name).toBe(gsh95.name);
    expect(report.totals.currentCapacity).toBeGreaterThan(0);
    expect(report.stockMethod).toContain("ยอดคงเหลือปัจจุบัน");
  });

  it("รายปีคืน 5 ปี และปฏิเสธปีอนาคต", async () => {
    const { year } = bangkokYearMonth();
    const report = await test
      .caller("admin")
      .reports.fuelStockSummary({ view: "yearly", year });
    expect(report.periods).toHaveLength(5);
    expect(report.periods.at(-1)?.key).toBe(String(year));
    expect(report.periods.at(-1)?.isPartial).toBe(true);

    await expect(
      test
        .caller("admin")
        .reports.fuelStockSummary({ view: "monthly", year: year + 1 })
    ).rejects.toThrow("อนาคต");
  });

  it("cashier เปิดรายงานสต๊อกน้ำมันไม่ได้", async () => {
    const { year } = bangkokYearMonth();
    await expect(
      test.caller("cashier").reports.fuelStockSummary({ view: "monthly", year })
    ).rejects.toThrow("สิทธิ์ไม่เพียงพอ");
    await expect(
      test
        .caller("cashier")
        .reports.exportFuelStockExcel({ view: "monthly", year })
    ).rejects.toThrow("สิทธิ์ไม่เพียงพอ");
  });

  it("แยกข้อมูลตามสาขา", async () => {
    const main = test.caller("admin");
    const created = await main.auth.createBranch({
      code: "FUEL2",
      name: "สาขารายงานน้ำมัน 2",
      address: "",
      phone: "",
      taxId: "",
      cloneCurrentSetup: true,
    });
    const second = test.caller("admin", 1, created.branch.id);
    const secondProducts = await second.catalog.listProducts();
    const secondGsh95 = secondProducts.find(
      product => product.code === "GSH95"
    );
    const secondTanks = await second.catalog.listTanks();
    const secondTank = secondTanks.find(
      tank => tank.productId === secondGsh95?.id
    );
    if (!secondGsh95 || !secondTank) {
      throw new Error("สาขาสองไม่มีข้อมูล GSH95");
    }
    await second.catalog.refillTank({
      tankId: secondTank.id,
      liters: 777,
      costPerLiter: 12,
    });

    const { year, key } = bangkokYearMonth();
    const [mainReport, secondReport] = await Promise.all([
      main.reports.fuelStockSummary({ view: "monthly", year }),
      second.reports.fuelStockSummary({ view: "monthly", year }),
    ]);
    expect(
      mainReport.periods.find(period => period.key === key)?.receivedLiters
    ).toBe(100);
    expect(
      secondReport.periods.find(period => period.key === key)?.receivedLiters
    ).toBe(777);
  });

  it("ส่งออก Excel สรุปรับเข้า ขายออก ยอดขาย และคงเหลือตามชนิด", async () => {
    const { year, key } = bangkokYearMonth();
    const month = Number(key.slice(5));
    const exported = await test
      .caller("manager")
      .reports.exportFuelStockExcel({ view: "monthly", year, month });
    expect(exported.fileName).toBe(
      `fuel-stock-${year}-${String(month).padStart(2, "0")}.xlsx`
    );

    const workbook = new ExcelJS.Workbook();
    const buffer = Buffer.from(exported.contentBase64, "base64");
    await workbook.xlsx.load(
      buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]
    );
    expect(workbook.worksheets.map(sheet => sheet.name)).toEqual([
      "สรุปสต๊อกน้ำมัน",
    ]);
    const summarySheet = workbook.getWorksheet("สรุปสต๊อกน้ำมัน")!;
    expect(summarySheet.rowCount).toBeGreaterThan(3);
    expect(summarySheet.getRow(3).values).toEqual([
      undefined,
      "รหัส",
      "ชนิดน้ำมัน",
      "รับเข้า (ลิตร)",
      "ขายออก (ลิตร)",
      "ยอดขาย",
      "คงเหลือปัจจุบัน (ลิตร)",
    ]);
    expect(summarySheet.getRow(summarySheet.rowCount).getCell(6).value).toBe(
      "แยกตามชนิด"
    );
    const gsh95Row = summarySheet
      .getRows(4, summarySheet.rowCount - 3)
      ?.find(row => row.getCell(1).value === "GSH95");
    expect(gsh95Row?.getCell(3).value).toBe(100);
    expect(gsh95Row?.getCell(4).value).toBe(10);
    expect(gsh95Row?.getCell(5).value).toBeCloseTo(407.4, 2);
  });
});
