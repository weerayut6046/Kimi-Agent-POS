import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq } from "drizzle-orm";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { afterEach, describe, expect, it } from "vitest";
import * as schema from "./schema";
import * as relations from "./relations";
import {
  branches,
  fuelTanks,
  nozzles,
  products,
  pumps,
  saleItems,
  sales,
  shiftReadings,
  shifts,
  tankRefills,
} from "./schema";

/**
 * เทส migration 0019 ที่ปรับผังปั๊มของฐานข้อมูลที่ใช้งานอยู่จริง
 * สร้างฐานที่ยังเป็นผังเดิม (ตู้ 2 จ่าย GSH91) แล้วรัน migration ทับ
 * เพื่อยืนยันว่าไม่มีการเขียนทับประวัติกะย้อนหลัง
 */
const migrationDir = fileURLToPath(
  new URL("./migrations-postgres/", import.meta.url)
);
const LAYOUT_MIGRATION = "0019_station_layout_gsh95_both_pumps.sql";
const layoutSql = fs.readFileSync(
  path.join(migrationDir, LAYOUT_MIGRATION),
  "utf8"
);

let openDb: PGlite | null = null;
afterEach(async () => {
  await openDb?.close();
  openDb = null;
});

/** ฐานข้อมูลเปล่าที่รัน migration ครบทุกไฟล์แล้ว (0019 จะไม่ทำอะไรเพราะยังไม่มีข้อมูล) */
async function freshDb() {
  const pg = new PGlite();
  openDb = pg;
  await pg.exec("CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;");
  const files = fs
    .readdirSync(migrationDir)
    .filter(file => file.endsWith(".sql"))
    .sort();
  for (const file of files) {
    await pg.exec(fs.readFileSync(path.join(migrationDir, file), "utf8"));
  }
  return {
    pg,
    db: drizzle({ client: pg, schema: { ...schema, ...relations } }),
  };
}

type Db = Awaited<ReturnType<typeof freshDb>>["db"];

/** สร้างผังเดิมของ seed รุ่นก่อน: ตู้ 1 = GSH95/DB7, ตู้ 2 = GSH91/DB7 */
async function seedOldLayout(db: Db) {
  // migration 0005 สร้างสาขา MAIN ไว้แล้ว จึงใช้สาขาเดิมถ้ามี
  await db
    .insert(branches)
    .values({ code: "MAIN", name: "สาขาหลัก" })
    .onConflictDoNothing();
  const branch = await db.query.branches.findFirst({
    where: eq(branches.code, "MAIN"),
  });
  const branchId = branch!.id;

  const productRows = await db
    .insert(products)
    .values([
      {
        branchId,
        code: "GSH95",
        name: "แก๊สโซฮอล์ 95",
        category: "fuel",
        unit: "ลิตร",
        price: 40.74,
        cost: 39.2,
      },
      {
        branchId,
        code: "GSH91",
        name: "แก๊สโซฮอล์ 91",
        category: "fuel",
        unit: "ลิตร",
        price: 38.18,
        cost: 36.7,
      },
      {
        branchId,
        code: "DB7",
        name: "ดีเซล B7",
        category: "fuel",
        unit: "ลิตร",
        price: 31.94,
        cost: 30.6,
      },
    ])
    .returning();
  const pid = (code: string) => productRows.find(row => row.code === code)!.id;

  const tankRows = await db
    .insert(fuelTanks)
    .values([
      {
        branchId,
        productId: pid("GSH95"),
        name: "ถัง GSH95",
        capacityLiters: 20000,
        currentLiters: 12450,
        lowAlertAt: 4000,
      },
      {
        branchId,
        productId: pid("GSH91"),
        name: "ถัง GSH91",
        capacityLiters: 15000,
        currentLiters: 6200,
        lowAlertAt: 3000,
      },
      {
        branchId,
        productId: pid("DB7"),
        name: "ถังดีเซล B7",
        capacityLiters: 20000,
        currentLiters: 3100,
        lowAlertAt: 4000,
      },
    ])
    .returning();
  const tid = (code: string) =>
    tankRows.find(row => row.productId === pid(code))!.id;

  const [pump1] = await db
    .insert(pumps)
    .values({ branchId, name: "ตู้จ่าย 1" })
    .returning();
  const [pump2] = await db
    .insert(pumps)
    .values({ branchId, name: "ตู้จ่าย 2" })
    .returning();

  const nozzleRows = await db
    .insert(nozzles)
    .values([
      {
        branchId,
        pumpId: pump1!.id,
        productId: pid("GSH95"),
        tankId: tid("GSH95"),
        label: "ตู้ 1 (ซ้าย) - GSH95",
        currentMeter: 152340.5,
        currentMoney: 6206318.75,
      },
      {
        branchId,
        pumpId: pump1!.id,
        productId: pid("DB7"),
        tankId: tid("DB7"),
        label: "ตู้ 1 (ขวา) - DB7",
        currentMeter: 98512.25,
        currentMoney: 3146447,
      },
      {
        branchId,
        pumpId: pump2!.id,
        productId: pid("GSH91"),
        tankId: tid("GSH91"),
        label: "ตู้ 2 (ซ้าย) - GSH91",
        currentMeter: 76420,
        currentMoney: 2918351.5,
      },
      {
        branchId,
        pumpId: pump2!.id,
        productId: pid("DB7"),
        tankId: tid("DB7"),
        label: "ตู้ 2 (ขวา) - DB7",
        currentMeter: 64110.75,
        currentMoney: 2047969.25,
      },
    ])
    .returning();

  return {
    branchId,
    pid,
    tid,
    pump2Id: pump2!.id,
    gsh91NozzleId: nozzleRows.find(row => row.productId === pid("GSH91"))!.id,
  };
}

/** ผังที่คาดหวังหลัง migration: 2 ตู้ ตู้ละ 2 หัวที่ใช้งานอยู่ = GSH95 + DB7 */
async function activeLayout(db: Db, branchId: number) {
  const rows = await db.query.nozzles.findMany({
    where: and(eq(nozzles.branchId, branchId), eq(nozzles.active, true)),
  });
  const productRows = await db.query.products.findMany();
  const codeOf = (productId: number) =>
    productRows.find(row => row.id === productId)!.code;
  const byPump = new Map<number, string[]>();
  for (const row of rows) {
    byPump.set(row.pumpId, [
      ...(byPump.get(row.pumpId) ?? []),
      codeOf(row.productId),
    ]);
  }
  return [...byPump.values()].map(codes => codes.sort());
}

describe("migration 0019 — ปรับผังปั๊มของฐานข้อมูลที่ใช้งานอยู่", () => {
  it("ปั๊มที่ยังไม่มีประวัติกะ: ย้ายหัวจ่ายเดิมเป็น GSH95 และเก็บกวาด GSH91 ให้หมด", async () => {
    const { db } = await freshDb();
    const { branchId, gsh91NozzleId } = await seedOldLayout(db);

    await db.execute(layoutSql);

    expect(await activeLayout(db, branchId)).toEqual([
      ["DB7", "GSH95"],
      ["DB7", "GSH95"],
    ]);

    // ไม่มีหัวจ่ายค้าง — หัวเดิมถูกแก้ในที่เดิม ไม่ได้สร้างใหม่
    const allNozzles = await db.query.nozzles.findMany();
    expect(allNozzles).toHaveLength(4);
    const moved = allNozzles.find(row => row.id === gsh91NozzleId)!;
    expect(moved.active).toBe(true);
    expect(moved.label).toBe("ตู้ 2 (ซ้าย) - GSH95");

    // หัวจ่าย GSH95 ทั้งสองตู้ใช้ถังใบเดียวกัน
    const gsh95Product = await db.query.products.findFirst({
      where: eq(products.code, "GSH95"),
    });
    const gsh95Nozzles = allNozzles.filter(
      row => row.productId === gsh95Product!.id
    );
    expect(gsh95Nozzles).toHaveLength(2);
    expect(new Set(gsh95Nozzles.map(row => row.tankId)).size).toBe(1);

    // ไม่มีสินค้า/ถัง GSH91 หลงเหลือให้กวนรายงานสต๊อก
    expect(
      await db.query.products.findFirst({ where: eq(products.code, "GSH91") })
    ).toBeUndefined();
    expect(await db.query.fuelTanks.findMany()).toHaveLength(2);
  });

  it("ปั๊มที่มีประวัติกะแล้ว: ปลดระวางหัวเดิมและเพิ่มหัวใหม่ โดยไม่แตะประวัติย้อนหลัง", async () => {
    const { db } = await freshDb();
    const { branchId, pid, tid, pump2Id, gsh91NozzleId } =
      await seedOldLayout(db);

    // ประวัติจริงของ GSH91: กะที่ปิดแล้ว + บิลขาย + การรับน้ำมันเข้าถัง
    const [shift] = await db
      .insert(shifts)
      .values({
        branchId,
        staffName: "กะเก่า",
        openedAt: new Date("2026-06-01T06:00:00+07:00"),
        closedAt: new Date("2026-06-01T14:00:00+07:00"),
        status: "closed",
      })
      .returning();
    await db.insert(shiftReadings).values({
      branchId,
      shiftId: shift!.id,
      nozzleId: gsh91NozzleId,
      openMeter: 76420,
      closeMeter: 76520,
      pricePerLiter: 38.18,
    });
    const [sale] = await db
      .insert(sales)
      .values({ branchId, receiptNo: "R-OLD-1", subtotal: 381.8, total: 381.8 })
      .returning();
    await db.insert(saleItems).values({
      branchId,
      saleId: sale!.id,
      productId: pid("GSH91"),
      name: "แก๊สโซฮอล์ 91",
      qty: 10,
      unit: "ลิตร",
      unitPrice: 38.18,
      amount: 381.8,
    });
    await db.insert(tankRefills).values({
      branchId,
      tankId: tid("GSH91"),
      liters: 5000,
      costPerLiter: 36.7,
    });

    await db.execute(layoutSql);

    // ผังที่ใช้งานได้ถูกต้องแล้ว
    expect(await activeLayout(db, branchId)).toEqual([
      ["DB7", "GSH95"],
      ["DB7", "GSH95"],
    ]);

    // หัวจ่ายเดิมยังอยู่ ยังเป็น GSH91 และถูกปลดระวางเท่านั้น
    const oldNozzle = await db.query.nozzles.findFirst({
      where: eq(nozzles.id, gsh91NozzleId),
    });
    expect(oldNozzle!.active).toBe(false);
    expect(oldNozzle!.productId).toBe(pid("GSH91"));
    expect(oldNozzle!.tankId).toBe(tid("GSH91"));

    // ประวัติกะยังชี้หัวจ่ายเดิม → รายงานย้อนหลังยังนับเป็น GSH91 เหมือนเดิม
    const readings = await db.query.shiftReadings.findMany();
    expect(readings).toHaveLength(1);
    expect(readings[0]!.nozzleId).toBe(gsh91NozzleId);
    expect(readings[0]!.pricePerLiter).toBe(38.18);

    // หัวจ่ายใหม่อยู่ตู้เดิม ผูกถัง GSH95 และยกเลขมิเตอร์/เลข P มาต่อ
    const newNozzle = (
      await db.query.nozzles.findMany({
        where: and(eq(nozzles.pumpId, pump2Id), eq(nozzles.active, true)),
      })
    ).find(row => row.productId === pid("GSH95"))!;
    expect(newNozzle.tankId).toBe(tid("GSH95"));
    expect(newNozzle.currentMeter).toBe(76420);
    expect(newNozzle.currentMoney).toBe(2918351.5);
    expect(newNozzle.label).toBe("ตู้ 2 (ซ้าย) - GSH95");

    // ถังและสินค้า GSH91 ยังอยู่เพราะมีประวัติ — แค่ปิดการใช้งานสินค้า
    expect(await db.query.tankRefills.findMany()).toHaveLength(1);
    const gsh91Product = await db.query.products.findFirst({
      where: eq(products.code, "GSH91"),
    });
    expect(gsh91Product!.active).toBe(false);
    const items = await db.query.saleItems.findMany();
    expect(items[0]!.productId).toBe(pid("GSH91"));
  });

  it("รันซ้ำได้โดยไม่สร้างหัวจ่ายซ้ำ", async () => {
    const { db } = await freshDb();
    const { branchId, gsh91NozzleId } = await seedOldLayout(db);
    await db
      .insert(shifts)
      .values({ branchId, staffName: "กะเก่า" })
      .returning();
    const openShift = await db.query.shifts.findFirst();
    await db.insert(shiftReadings).values({
      branchId,
      shiftId: openShift!.id,
      nozzleId: gsh91NozzleId,
      openMeter: 76420,
      pricePerLiter: 38.18,
    });

    await db.execute(layoutSql);
    const afterFirst = await db.query.nozzles.findMany();
    await db.execute(layoutSql);
    await db.execute(layoutSql);
    const afterThird = await db.query.nozzles.findMany();

    expect(afterThird).toHaveLength(afterFirst.length);
    expect(afterThird.map(row => row.id).sort()).toEqual(
      afterFirst.map(row => row.id).sort()
    );
    expect(await activeLayout(db, branchId)).toEqual([
      ["DB7", "GSH95"],
      ["DB7", "GSH95"],
    ]);
  });

  it("ข้ามสาขาที่ไม่มี GSH95 ให้ย้ายไป แทนที่จะทำข้อมูลพัง", async () => {
    const { db } = await freshDb();
    const [branch] = await db
      .insert(branches)
      .values({ code: "NO95", name: "สาขาไม่มี 95" })
      .returning();
    const branchId = branch!.id;
    const [gsh91] = await db
      .insert(products)
      .values({
        branchId,
        code: "GSH91",
        name: "แก๊สโซฮอล์ 91",
        category: "fuel",
        unit: "ลิตร",
        price: 38.18,
      })
      .returning();
    const [tank] = await db
      .insert(fuelTanks)
      .values({
        branchId,
        productId: gsh91!.id,
        name: "ถัง GSH91",
        capacityLiters: 15000,
        currentLiters: 6200,
      })
      .returning();
    const [pump] = await db
      .insert(pumps)
      .values({ branchId, name: "ตู้จ่าย 1" })
      .returning();
    await db.insert(nozzles).values({
      branchId,
      pumpId: pump!.id,
      productId: gsh91!.id,
      tankId: tank!.id,
      label: "ตู้ 1 (ซ้าย) - GSH91",
    });

    await db.execute(layoutSql);

    const remaining = await db.query.nozzles.findMany();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.productId).toBe(gsh91!.id);
    expect(remaining[0]!.active).toBe(true);
  });
});
