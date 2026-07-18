import { createHash } from "crypto";
import { getDb } from "../api/queries/connection";
import {
  staffUsers,
  products,
  pumps,
  nozzles,
  fuelTanks,
  members,
  rewards,
  settings,
} from "./schema";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

async function seed() {
  const db = getDb();

  const existing = await db.query.staffUsers.findFirst();
  if (existing) {
    console.log("Database already seeded, skipping.");
    process.exit(0);
  }

  console.log("Seeding database...");

  // พนักงาน
  await db.insert(staffUsers).values([
    { username: "admin", pin: sha256("1234"), name: "เจ้าของปั๊ม", role: "admin" },
    { username: "manager", pin: sha256("2222"), name: "สมหญิง (ผู้จัดการสาขา)", role: "manager" },
    { username: "somchai", pin: sha256("0000"), name: "สมชาย (พนักงาน)", role: "cashier" },
  ]);

  // สินค้า: น้ำมัน
  await db.insert(products).values([
    { code: "GSH95", name: "แก๊สโซฮอล์ 95", category: "fuel", unit: "ลิตร", price: 40.74, cost: 39.2 },
    { code: "GSH91", name: "แก๊สโซฮอล์ 91", category: "fuel", unit: "ลิตร", price: 38.18, cost: 36.7 },
    { code: "DB7", name: "ดีเซล B7", category: "fuel", unit: "ลิตร", price: 31.94, cost: 30.6 },
  ]);
  // สินค้า: 2T / น้ำมันเครื่อง / อื่นๆ
  await db.insert(products).values([
    { code: "2T-PTT", name: "น้ำมัน 2T (ขวดเล็ก)", category: "lubricant", unit: "ขวด", price: 45, cost: 32, stockQty: 48, lowStockAt: 12 },
    { code: "2T-BIG", name: "น้ำมัน 2T (ขวดใหญ่)", category: "lubricant", unit: "ขวด", price: 85, cost: 60, stockQty: 30, lowStockAt: 8 },
    { code: "LUBE-MC", name: "น้ำมันเครื่องมอเตอร์ไซค์ 0.8L", category: "lubricant", unit: "ขวด", price: 145, cost: 105, stockQty: 24, lowStockAt: 6 },
    { code: "WATER", name: "น้ำดื่ม 600 มล.", category: "other", unit: "ขวด", price: 10, cost: 5, stockQty: 120, lowStockAt: 24 },
    { code: "TISSUE", name: "กระดาษทิชชู", category: "other", unit: "ห่อ", price: 20, cost: 12, stockQty: 40, lowStockAt: 10 },
  ]);

  // ตู้จ่าย 2 ตู้ (ตู้ 1: GSH95 ซ้าย / DB7 ขวา, ตู้ 2: GSH91 ซ้าย / DB7 ขวา)
  const [{ id: pump1 }] = await db.insert(pumps).values({ name: "ตู้จ่าย 1" }).$returningId();
  const [{ id: pump2 }] = await db.insert(pumps).values({ name: "ตู้จ่าย 2" }).$returningId();

  const prodRows = await db.query.products.findMany();
  const pid = (code: string) => prodRows.find((p) => p.code === code)!.id;

  await db.insert(nozzles).values([
    { pumpId: pump1, productId: pid("GSH95"), label: "ตู้ 1 (ซ้าย) - GSH95", currentMeter: 152340.5, currentMoney: 6206318.75 },
    { pumpId: pump1, productId: pid("DB7"), label: "ตู้ 1 (ขวา) - DB7", currentMeter: 98512.25, currentMoney: 3146447.0 },
    { pumpId: pump2, productId: pid("GSH91"), label: "ตู้ 2 (ซ้าย) - GSH91", currentMeter: 76420.0, currentMoney: 2918351.5 },
    { pumpId: pump2, productId: pid("DB7"), label: "ตู้ 2 (ขวา) - DB7", currentMeter: 64110.75, currentMoney: 2047969.25 },
  ]);

  // ถังน้ำมัน
  await db.insert(fuelTanks).values([
    { productId: pid("GSH95"), name: "ถัง GSH95", capacityLiters: 20000, currentLiters: 12450, lowAlertAt: 4000 },
    { productId: pid("GSH91"), name: "ถัง GSH91", capacityLiters: 15000, currentLiters: 6200, lowAlertAt: 3000 },
    { productId: pid("DB7"), name: "ถังดีเซล B7", capacityLiters: 20000, currentLiters: 3100, lowAlertAt: 4000 },
  ]);

  // สมาชิกตัวอย่าง
  await db.insert(members).values([
    { memberCode: "M0001", name: "สมหญิง ใจดี", phone: "0812345678", points: 320, tier: "gold" },
    { memberCode: "M0002", name: "วิชัย ขยันขับ", phone: "0898765432", points: 85, tier: "silver" },
    { memberCode: "M0003", name: "ร้านกาแฟสด (รถตู้)", phone: "0861112222", points: 1240, tier: "platinum" },
  ]);

  // ของรางวัล
  await db.insert(rewards).values([
    { name: "น้ำดื่ม 1 ขวด", pointsRequired: 30, stock: 100 },
    { name: "กระดาษทิชชู 1 ห่อ", pointsRequired: 50, stock: 60 },
    { name: "ส่วนลด 20 บาท", pointsRequired: 100, stock: 999 },
    { name: "น้ำมัน 2T 1 ขวด", pointsRequired: 200, stock: 25 },
    { name: "ส่วนลด 100 บาท", pointsRequired: 450, stock: 999 },
  ]);

  // ตั้งค่าร้าน
  await db.insert(settings).values([
    { key: "shop_name", value: "ปั๊มน้ำมันกลางใหญ่บริการ" },
    { key: "shop_branch", value: "สาขาหลัก" },
    { key: "shop_address", value: "123 ถ.ตัวอย่าง ต.ในเมือง อ.เมือง จ.ขอนแก่น 40000" },
    { key: "tax_id", value: "0105566001123" },
    { key: "shop_phone", value: "02-123-4567" },
    { key: "vat_rate", value: "7" },
    { key: "point_earn_per_baht", value: "25" },
    { key: "point_redeem_value", value: "1" },
    { key: "receipt_prefix", value: "R" },
    { key: "receipt_next_no", value: "1" },
    { key: "tax_invoice_prefix", value: "T" },
    { key: "tax_invoice_next_no", value: "1" },
  ]);

  console.log("Done.");
  process.exit(0);
}

seed();
