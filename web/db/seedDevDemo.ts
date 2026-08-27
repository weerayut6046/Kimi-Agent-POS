import { and, eq } from "drizzle-orm";
import { getDb } from "../api/queries/connection";
import { env } from "../api/lib/env";
import { hashLocalPassword } from "../api/lib/localPassword";
import {
  branches,
  customers,
  debtPayments,
  employeeProfiles,
  expenses,
  fuelTanks,
  nozzles,
  payrollRecords,
  pointTransactions,
  products,
  saleItems,
  sales,
  shifts,
  shiftReadings,
  staffBranches,
  staffUsers,
  stockCountItems,
  stockCountSessions,
  tankReadings,
  tankRefills,
  taxInvoices,
  workSchedules,
  workShiftTemplates,
} from "./schema";

const DAY_MS = 24 * 60 * 60 * 1_000;

export type DevDemoSeedResult = {
  skipped: boolean;
  daysCreated: number;
  salesCreated: number;
};

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function bangkokDateKey(offsetDays = 0): string {
  // Thailand has no daylight-saving time, so this is a stable local date.
  return new Date(Date.now() + 7 * 60 * 60 * 1_000 + offsetDays * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

function bangkokInstant(dateKey: string, hour: number, minute = 0): Date {
  return new Date(
    `${dateKey}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+07:00`
  );
}

function previousMonth(dateKey: string): string {
  const [year, month] = dateKey.split("-").map(Number);
  return month === 1
    ? `${year - 1}-12`
    : `${year}-${String(month - 1).padStart(2, "0")}`;
}

/** Add clearly-labelled, idempotent demo rows only in Local Dev mode. */
export async function seedDevDemoData(): Promise<DevDemoSeedResult> {
  if (
    env.isProduction ||
    !env.localAuthEnabled ||
    process.env.NODE_ENV === "test"
  ) {
    return { skipped: true, daysCreated: 0, salesCreated: 0 };
  }

  const db = getDb();
  const mainBranch = await db.query.branches.findFirst({
    where: eq(branches.code, "MAIN"),
  });
  if (!mainBranch) {
    throw new Error("Cannot create Dev demo data: MAIN branch is missing");
  }

  const staffSpecs = [
    {
      username: "devmanager",
      password: "DevManager123!",
      name: "ผู้จัดการ (ข้อมูลทดลอง)",
      role: "manager" as const,
      position: "ผู้จัดการสถานีบริการ",
      baseRate: 25_000,
      overtimeRate: 180,
    },
    {
      username: "devcashier",
      password: "DevCashier123!",
      name: "พนักงานขาย (ข้อมูลทดลอง)",
      role: "cashier" as const,
      position: "พนักงานหน้าลาน",
      baseRate: 15_000,
      overtimeRate: 100,
    },
  ];
  const demoStaff: Array<{
    id: number;
    name: string;
    role: "manager" | "cashier";
    baseRate: number;
    overtimeRate: number;
  }> = [];

  for (const spec of staffSpecs) {
    let staff = await db.query.staffUsers.findFirst({
      where: eq(staffUsers.username, spec.username),
    });
    if (!staff) {
      [staff] = await db
        .insert(staffUsers)
        .values({
          username: spec.username,
          pin: await hashLocalPassword(spec.password),
          name: spec.name,
          role: spec.role,
        })
        .returning();
    }
    await db
      .insert(staffBranches)
      .values({ staffId: staff.id, branchId: mainBranch.id, isDefault: true })
      .onConflictDoNothing();
    await db
      .insert(employeeProfiles)
      .values({
        staffId: staff.id,
        position: spec.position,
        salaryType: "monthly",
        baseRate: spec.baseRate,
        overtimeRate: spec.overtimeRate,
        hireDate: "2025-01-15",
        note: "DEV-DEMO",
      })
      .onConflictDoNothing();
    demoStaff.push({
      id: staff.id,
      name: staff.name,
      role: spec.role,
      baseRate: spec.baseRate,
      overtimeRate: spec.overtimeRate,
    });
  }

  const today = bangkokDateKey();
  const payrollMonth = previousMonth(today);
  for (const [index, staff] of demoStaff.entries()) {
    const overtimeHours = index === 0 ? 6 : 12;
    const overtimeAmount = overtimeHours * staff.overtimeRate;
    const bonus = index === 0 ? 1_000 : 500;
    await db
      .insert(payrollRecords)
      .values({
        branchId: mainBranch.id,
        payrollMonth,
        staffId: staff.id,
        workDays: 26,
        workHours: 208,
        baseAmount: staff.baseRate,
        overtimeHours,
        overtimeAmount,
        bonus,
        netAmount: staff.baseRate + overtimeAmount + bonus,
        status: "paid",
        paidAt: bangkokInstant(today, 9),
        note: "DEV-DEMO",
      })
      .onConflictDoNothing();
  }

  const templates = await db.query.workShiftTemplates.findMany({
    where: eq(workShiftTemplates.branchId, mainBranch.id),
  });
  if (templates.length > 0) {
    for (let offset = -6; offset <= 0; offset += 1) {
      await db
        .insert(workSchedules)
        .values({
          branchId: mainBranch.id,
          workDate: bangkokDateKey(offset),
          shiftTemplateId: templates[(offset + 6) % templates.length].id,
          staffId: demoStaff[(offset + 6) % demoStaff.length].id,
          status: offset < 0 ? "completed" : "scheduled",
          note: "DEV-DEMO",
        })
        .onConflictDoNothing();
    }
  }

  const customerSpecs = [
    {
      name: "บริษัท เดโม โลจิสติกส์ จำกัด",
      taxId: "0999999999991",
      branch: "สำนักงานใหญ่",
      address: "99 ถนนตัวอย่าง แขวงตัวอย่าง เขตตัวอย่าง กรุงเทพฯ 10000",
      phone: "0800000001",
      vehiclePlate: "กข 9999",
      creditLimit: 50_000,
    },
    {
      name: "ร้านตัวอย่างการเกษตร",
      taxId: "0999999999992",
      branch: "สำนักงานใหญ่",
      address: "88 หมู่ 8 ตำบลตัวอย่าง อำเภอตัวอย่าง นครราชสีมา 30000",
      phone: "0800000002",
      vehiclePlate: "บต 8888",
      creditLimit: 20_000,
    },
  ];
  const demoCustomers: Array<typeof customers.$inferSelect> = [];
  for (const spec of customerSpecs) {
    let customer = await db.query.customers.findFirst({
      where: eq(customers.taxId, spec.taxId),
    });
    if (!customer) {
      [customer] = await db.insert(customers).values(spec).returning();
    }
    demoCustomers.push(customer);
  }

  const productRows = await db.query.products.findMany({
    where: eq(products.branchId, mainBranch.id),
  });
  const productByCode = new Map(productRows.map(product => [product.code, product]));
  for (const code of ["GSH95", "DB7", "2T-PTT", "LUBE-MC", "WATER"]) {
    if (!productByCode.has(code)) {
      throw new Error(`Cannot create Dev demo data: product ${code} is missing`);
    }
  }

  const memberRows = await db.query.members.findMany();
  const memberByCode = new Map(memberRows.map(member => [member.memberCode, member]));
  const nozzleRows = await db.query.nozzles.findMany({
    where: eq(nozzles.branchId, mainBranch.id),
  });
  const tankRows = await db.query.fuelTanks.findMany({
    where: eq(fuelTanks.branchId, mainBranch.id),
  });
  const cashier = demoStaff.find(staff => staff.role === "cashier")!;
  let daysCreated = 0;
  let salesCreated = 0;

  for (let offset = -6; offset <= 0; offset += 1) {
    const dateKey = bangkokDateKey(offset);
    const receiptPrefix = `DEV-${dateKey.replaceAll("-", "")}`;
    const marker = await db.query.sales.findFirst({
      where: and(
        eq(sales.branchId, mainBranch.id),
        eq(sales.receiptNo, `${receiptPrefix}-01`)
      ),
    });
    if (marker) continue;

    const dayIndex = offset + 6;
    const makeLine = (code: string, qty: number) => {
      const product = productByCode.get(code)!;
      return { product, qty, amount: roundMoney(qty * product.price) };
    };
    const saleDefinitions = [
      {
        paymentMethod: "cash" as const,
        member: memberByCode.get("M0001"),
        customer: undefined,
        hour: 7,
        minute: 20,
        lines: [makeLine("GSH95", 18 + dayIndex)],
      },
      {
        paymentMethod: "qr" as const,
        member: memberByCode.get("M0002"),
        customer: undefined,
        hour: 9,
        minute: 5,
        lines: [makeLine("DB7", 24 + dayIndex), makeLine("WATER", 2)],
      },
      {
        paymentMethod: "card" as const,
        member: undefined,
        customer: undefined,
        hour: 11,
        minute: 15,
        lines: [makeLine("LUBE-MC", 1), makeLine("2T-PTT", 2)],
      },
      {
        paymentMethod: "credit" as const,
        member: memberByCode.get("M0003"),
        customer: demoCustomers[dayIndex % demoCustomers.length],
        hour: 13,
        minute: 10,
        lines: [makeLine(dayIndex % 2 === 0 ? "DB7" : "GSH95", 30 + dayIndex)],
      },
    ];
    const totals = saleDefinitions.map(definition =>
      roundMoney(definition.lines.reduce((sum, line) => sum + line.amount, 0))
    );
    const totalAmount = roundMoney(totals.reduce((sum, total) => sum + total, 0));
    const totalLiters = saleDefinitions.reduce(
      (sum, definition) =>
        sum +
        definition.lines
          .filter(line => line.product.category === "fuel")
          .reduce((lineSum, line) => lineSum + line.qty, 0),
      0
    );
    const fuelAmount = roundMoney(
      saleDefinitions.reduce(
        (sum, definition) =>
          sum +
          definition.lines
            .filter(line => line.product.category === "fuel")
            .reduce((lineSum, line) => lineSum + line.amount, 0),
        0
      )
    );
    const cashTotal = totals[0];
    const transferTotal = roundMoney(totals[1] + totals[2]);
    const openingFloat = 1_000;
    const expenseAmount = 120 + dayIndex * 10;

    let created = false;
    await db.transaction(async tx => {
      const existingDay = await tx.query.sales.findFirst({
        where: and(
          eq(sales.branchId, mainBranch.id),
          eq(sales.receiptNo, `${receiptPrefix}-01`)
        ),
      });
      if (existingDay) return;

      const [shift] = await tx
        .insert(shifts)
        .values({
          branchId: mainBranch.id,
          staffId: cashier.id,
          staffName: cashier.name,
          openedAt: bangkokInstant(dateKey, 6),
          closedAt: bangkokInstant(dateKey, 14),
          status: "closed",
          totalLiters,
          totalAmount,
          totalMoneyMeter: fuelAmount,
          posAmount: totalAmount,
          countedCash: roundMoney(openingFloat + cashTotal - expenseAmount),
          transferAmount: transferTotal,
          openingFloat,
          expectedCash: roundMoney(openingFloat + cashTotal - expenseAmount),
          cashCounts: JSON.stringify({ "1000": 1, "100": 5, "20": 5 }),
          note: "DEV-DEMO: กะปิดย้อนหลังสำหรับทดสอบรายงาน",
        })
        .returning();

      for (const [saleIndex, definition] of saleDefinitions.entries()) {
        const total = totals[saleIndex];
        const received =
          definition.paymentMethod === "cash" ? Math.ceil(total / 100) * 100 : total;
        const pointsEarned = definition.member ? Math.floor(total / 100) : 0;
        const [sale] = await tx
          .insert(sales)
          .values({
            branchId: mainBranch.id,
            receiptNo: `${receiptPrefix}-${String(saleIndex + 1).padStart(2, "0")}`,
            shiftId: shift.id,
            staffName: cashier.name,
            memberId: definition.member?.id,
            customerId: definition.customer?.id,
            subtotal: total,
            vatRate: 7,
            vatAmount: roundMoney((total * 7) / 107),
            total,
            paymentMethod: definition.paymentMethod,
            received,
            changeAmt: roundMoney(received - total),
            pointsEarned,
            status: "completed",
            createdAt: bangkokInstant(dateKey, definition.hour, definition.minute),
          })
          .returning();

        await tx.insert(saleItems).values(
          definition.lines.map(line => ({
            branchId: mainBranch.id,
            saleId: sale.id,
            productId: line.product.id,
            name: line.product.name,
            qty: line.qty,
            unit: line.product.unit,
            unitPrice: line.product.price,
            amount: line.amount,
          }))
        );
        if (definition.member && pointsEarned > 0) {
          await tx.insert(pointTransactions).values({
            branchId: mainBranch.id,
            memberId: definition.member.id,
            saleId: sale.id,
            type: "earn",
            points: pointsEarned,
            note: "DEV-DEMO",
            createdAt: bangkokInstant(dateKey, definition.hour, definition.minute),
          });
        }
        if (definition.paymentMethod === "credit" && definition.customer) {
          await tx.insert(taxInvoices).values({
            branchId: mainBranch.id,
            taxInvoiceNo: `DEV-TAX-${dateKey.replaceAll("-", "")}`,
            saleId: sale.id,
            customerName: definition.customer.name,
            customerTaxId: definition.customer.taxId,
            customerBranch: definition.customer.branch,
            customerAddress: definition.customer.address,
            customerPhone: definition.customer.phone,
            vehiclePlate: definition.customer.vehiclePlate,
            issuedBy: cashier.name,
            createdAt: bangkokInstant(dateKey, 13, 15),
          });
        }
      }

      await tx.insert(expenses).values({
        branchId: mainBranch.id,
        title: dayIndex % 2 === 0 ? "น้ำดื่มพนักงาน (ทดลอง)" : "อุปกรณ์ทำความสะอาด (ทดลอง)",
        category: "ค่าใช้จ่ายทั่วไป",
        amount: expenseAmount,
        shiftId: shift.id,
        staffName: cashier.name,
        note: "DEV-DEMO",
        createdAt: bangkokInstant(dateKey, 12),
      });
      if (offset === 0) {
        await tx.insert(debtPayments).values({
          branchId: mainBranch.id,
          paymentNo: `DEV-PAY-${dateKey.replaceAll("-", "")}`,
          customerId: demoCustomers[0].id,
          amount: 500,
          method: "transfer",
          shiftId: shift.id,
          staffName: cashier.name,
          note: "DEV-DEMO: รับชำระหนี้บางส่วน",
          createdAt: bangkokInstant(dateKey, 13, 30),
        });
      }

      for (const [nozzleIndex, nozzle] of nozzleRows.entries()) {
        const product = productRows.find(row => row.id === nozzle.productId);
        if (!product) continue;
        const dispensed = roundMoney(8 + dayIndex + nozzleIndex * 1.25);
        const openMeter = roundMoney(50_000 + dayIndex * 200 + nozzleIndex * 1_000);
        const openMoney = roundMoney(openMeter * product.price);
        await tx.insert(shiftReadings).values({
          branchId: mainBranch.id,
          shiftId: shift.id,
          nozzleId: nozzle.id,
          openMeter,
          closeMeter: roundMoney(openMeter + dispensed),
          openMoney,
          closeMoney: roundMoney(openMoney + dispensed * product.price),
          pricePerLiter: product.price,
        });
      }
      for (const [tankIndex, tank] of tankRows.entries()) {
        await tx.insert(tankReadings).values({
          branchId: mainBranch.id,
          tankId: tank.id,
          liters: Math.max(
            0,
            roundMoney(tank.currentLiters + (6 - dayIndex) * 120 - tankIndex * 40)
          ),
          measuredAt: bangkokInstant(dateKey, 14),
          staffId: cashier.id,
          staffName: cashier.name,
          note: "DEV-DEMO",
          createdAt: bangkokInstant(dateKey, 14),
        });
      }
      if (offset === -3 && tankRows[0]) {
        await tx.insert(tankRefills).values({
          branchId: mainBranch.id,
          tankId: tankRows[0].id,
          liters: 5_000,
          costPerLiter: 38.5,
          note: "DEV-DEMO: รับน้ำมันเข้าถัง",
          createdAt: bangkokInstant(dateKey, 10),
        });
      }
      created = true;
    });
    if (created) {
      daysCreated += 1;
      salesCreated += saleDefinitions.length;
    }
  }

  const stockCountName = `DEV-DEMO-STOCK-${today}`;
  const existingStockCount = await db.query.stockCountSessions.findFirst({
    where: and(
      eq(stockCountSessions.branchId, mainBranch.id),
      eq(stockCountSessions.name, stockCountName)
    ),
  });
  if (!existingStockCount) {
    const stockProducts = productRows.filter(product => product.category !== "fuel");
    await db.transaction(async tx => {
      const [session] = await tx
        .insert(stockCountSessions)
        .values({
          branchId: mainBranch.id,
          name: stockCountName,
          scope: "all",
          status: "completed",
          startedById: cashier.id,
          startedByName: cashier.name,
          completedById: cashier.id,
          completedByName: cashier.name,
          note: "DEV-DEMO: รอบนับสต็อกตัวอย่าง",
          startedAt: bangkokInstant(today, 8),
          completedAt: bangkokInstant(today, 8, 30),
          updatedAt: bangkokInstant(today, 8, 30),
        })
        .returning();
      if (stockProducts.length > 0) {
        await tx.insert(stockCountItems).values(
          stockProducts.map((product, index) => ({
            branchId: mainBranch.id,
            sessionId: session.id,
            productId: product.id,
            productCode: product.code,
            productName: product.name,
            category: product.category as "lubricant" | "other",
            unit: product.unit,
            expectedQty: product.stockQty,
            countedQty: Math.max(0, product.stockQty - (index === 1 ? 1 : 0)),
            countedById: cashier.id,
            countedByName: cashier.name,
            countedAt: bangkokInstant(today, 8, 25),
            note: index === 1 ? "DEV-DEMO: ต่างจากระบบ 1 หน่วย" : "DEV-DEMO",
            updatedAt: bangkokInstant(today, 8, 25),
          }))
        );
      }
    });
  }

  return { skipped: false, daysCreated, salesCreated };
}
