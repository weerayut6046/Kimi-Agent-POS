import {
  mysqlTable,
  mysqlEnum,
  serial,
  bigint,
  varchar,
  text,
  mediumtext,
  timestamp,
  decimal,
  boolean,
  int,
  index,
} from "drizzle-orm/mysql-core";

// ============ พนักงาน ============
export const staffUsers = mysqlTable("staff_users", {
  id: serial("id").primaryKey(),
  username: varchar("username", { length: 64 }).notNull().unique(),
  pin: varchar("pin", { length: 128 }).notNull(), // SHA-256 hash
  name: varchar("name", { length: 128 }).notNull(),
  role: mysqlEnum("role", ["admin", "manager", "cashier"]).notNull().default("cashier"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ============ สินค้า (น้ำมัน / 2T / อื่นๆ) ============
export const products = mysqlTable(
  "products",
  {
    id: serial("id").primaryKey(),
    code: varchar("code", { length: 32 }).notNull().unique(), // GSH95, GSH91, DB7, 2T-xxx
    name: varchar("name", { length: 128 }).notNull(),
    category: mysqlEnum("category", ["fuel", "lubricant", "other"]).notNull(),
    unit: varchar("unit", { length: 16 }).notNull().default("ชิ้น"), // ลิตร / ขวด / ชิ้น
    price: decimal("price", { precision: 10, scale: 2, mode: "number" }).notNull(),
    cost: decimal("cost", { precision: 10, scale: 2, mode: "number" }).notNull().default(0),
    stockQty: decimal("stock_qty", { precision: 12, scale: 2, mode: "number" }).notNull().default(0),
    lowStockAt: decimal("low_stock_at", { precision: 12, scale: 2, mode: "number" }).notNull().default(0),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({ catIdx: index("cat_idx").on(t.category) }),
);

// ============ ตู้จ่าย & หัวจ่าย ============
export const pumps = mysqlTable("pumps", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 64 }).notNull(), // ตู้จ่าย 1
  active: boolean("active").notNull().default(true),
});

export const nozzles = mysqlTable(
  "nozzles",
  {
    id: serial("id").primaryKey(),
    pumpId: bigint("pump_id", { mode: "number", unsigned: true }).notNull(),
    productId: bigint("product_id", { mode: "number", unsigned: true }).notNull(),
    label: varchar("label", { length: 64 }).notNull(), // ตู้ 1 - GSH95
    currentMeter: decimal("current_meter", { precision: 14, scale: 2, mode: "number" }).notNull().default(0),
    currentMoney: decimal("current_money", { precision: 16, scale: 2, mode: "number" }).notNull().default(0), // มิเตอร์เงินสะสม P (บาท)
    active: boolean("active").notNull().default(true),
  },
  (t) => ({ pumpIdx: index("pump_idx").on(t.pumpId) }),
);

// ============ กะการทำงาน ============
export const shifts = mysqlTable("shifts", {
  id: serial("id").primaryKey(),
  staffId: bigint("staff_id", { mode: "number", unsigned: true }),
  staffName: varchar("staff_name", { length: 128 }).notNull(),
  openedAt: timestamp("opened_at").notNull().defaultNow(),
  closedAt: timestamp("closed_at"),
  status: mysqlEnum("status", ["open", "closed"]).notNull().default("open"),
  totalLiters: decimal("total_liters", { precision: 14, scale: 2, mode: "number" }).notNull().default(0),
  totalAmount: decimal("total_amount", { precision: 14, scale: 2, mode: "number" }).notNull().default(0),
  totalMoneyMeter: decimal("total_money_meter", { precision: 16, scale: 2, mode: "number" }).notNull().default(0), // ยอดจากมิเตอร์เงิน P
  posAmount: decimal("pos_amount", { precision: 14, scale: 2, mode: "number" }).notNull().default(0),
  note: text("note"),
});

export const shiftReadings = mysqlTable(
  "shift_readings",
  {
    id: serial("id").primaryKey(),
    shiftId: bigint("shift_id", { mode: "number", unsigned: true }).notNull(),
    nozzleId: bigint("nozzle_id", { mode: "number", unsigned: true }).notNull(),
    openMeter: decimal("open_meter", { precision: 14, scale: 2, mode: "number" }).notNull(),
    closeMeter: decimal("close_meter", { precision: 14, scale: 2, mode: "number" }),
    openMoney: decimal("open_money", { precision: 16, scale: 2, mode: "number" }).notNull().default(0), // P ตั้งต้น (บาท)
    closeMoney: decimal("close_money", { precision: 16, scale: 2, mode: "number" }), // P ปิดกะ (บาท)
    pricePerLiter: decimal("price_per_liter", { precision: 10, scale: 2, mode: "number" }).notNull().default(0),
  },
  (t) => ({ shiftIdx: index("shift_idx").on(t.shiftId) }),
);

// ============ การขาย ============
export const sales = mysqlTable(
  "sales",
  {
    id: serial("id").primaryKey(),
    receiptNo: varchar("receipt_no", { length: 32 }).notNull().unique(),
    shiftId: bigint("shift_id", { mode: "number", unsigned: true }),
    staffName: varchar("staff_name", { length: 128 }).notNull().default(""),
    memberId: bigint("member_id", { mode: "number", unsigned: true }),
    subtotal: decimal("subtotal", { precision: 12, scale: 2, mode: "number" }).notNull(),
    discount: decimal("discount", { precision: 12, scale: 2, mode: "number" }).notNull().default(0),
    vatRate: decimal("vat_rate", { precision: 5, scale: 2, mode: "number" }).notNull().default(7),
    vatAmount: decimal("vat_amount", { precision: 12, scale: 2, mode: "number" }).notNull().default(0),
    total: decimal("total", { precision: 12, scale: 2, mode: "number" }).notNull(),
    paymentMethod: mysqlEnum("payment_method", ["cash", "qr", "card"]).notNull().default("cash"),
    received: decimal("received", { precision: 12, scale: 2, mode: "number" }).notNull().default(0),
    changeAmt: decimal("change_amt", { precision: 12, scale: 2, mode: "number" }).notNull().default(0),
    pointsEarned: int("points_earned").notNull().default(0),
    pointsRedeemed: int("points_redeemed").notNull().default(0),
    status: mysqlEnum("status", ["completed", "voided"]).notNull().default("completed"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({ createdIdx: index("created_idx").on(t.createdAt) }),
);

export const saleItems = mysqlTable(
  "sale_items",
  {
    id: serial("id").primaryKey(),
    saleId: bigint("sale_id", { mode: "number", unsigned: true }).notNull(),
    productId: bigint("product_id", { mode: "number", unsigned: true }),
    name: varchar("name", { length: 128 }).notNull(),
    qty: decimal("qty", { precision: 12, scale: 2, mode: "number" }).notNull(),
    unit: varchar("unit", { length: 16 }).notNull().default("ชิ้น"),
    unitPrice: decimal("unit_price", { precision: 10, scale: 2, mode: "number" }).notNull(),
    amount: decimal("amount", { precision: 12, scale: 2, mode: "number" }).notNull(),
  },
  (t) => ({ saleIdx: index("sale_idx").on(t.saleId) }),
);

// ============ สมาชิกสะสมแต้ม ============
export const members = mysqlTable("members", {
  id: serial("id").primaryKey(),
  memberCode: varchar("member_code", { length: 32 }).notNull().unique(),
  name: varchar("name", { length: 128 }).notNull(),
  phone: varchar("phone", { length: 20 }).notNull().unique(),
  points: int("points").notNull().default(0),
  tier: mysqlEnum("tier", ["silver", "gold", "platinum"]).notNull().default("silver"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const pointTransactions = mysqlTable(
  "point_transactions",
  {
    id: serial("id").primaryKey(),
    memberId: bigint("member_id", { mode: "number", unsigned: true }).notNull(),
    saleId: bigint("sale_id", { mode: "number", unsigned: true }),
    type: mysqlEnum("type", ["earn", "redeem", "adjust"]).notNull(),
    points: int("points").notNull(),
    note: varchar("note", { length: 255 }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({ memberIdx: index("member_idx").on(t.memberId) }),
);

export const rewards = mysqlTable("rewards", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 128 }).notNull(),
  pointsRequired: int("points_required").notNull(),
  stock: int("stock").notNull().default(0),
  active: boolean("active").notNull().default(true),
});

export const rewardRedemptions = mysqlTable("reward_redemptions", {
  id: serial("id").primaryKey(),
  memberId: bigint("member_id", { mode: "number", unsigned: true }).notNull(),
  rewardId: bigint("reward_id", { mode: "number", unsigned: true }).notNull(),
  pointsUsed: int("points_used").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ============ ถังน้ำมัน ============
export const fuelTanks = mysqlTable("fuel_tanks", {
  id: serial("id").primaryKey(),
  productId: bigint("product_id", { mode: "number", unsigned: true }).notNull(),
  name: varchar("name", { length: 64 }).notNull(), // ถัง GSH95
  capacityLiters: decimal("capacity_liters", { precision: 12, scale: 2, mode: "number" }).notNull(),
  currentLiters: decimal("current_liters", { precision: 12, scale: 2, mode: "number" }).notNull().default(0),
  lowAlertAt: decimal("low_alert_at", { precision: 12, scale: 2, mode: "number" }).notNull().default(0),
});

export const tankRefills = mysqlTable("tank_refills", {
  id: serial("id").primaryKey(),
  tankId: bigint("tank_id", { mode: "number", unsigned: true }).notNull(),
  liters: decimal("liters", { precision: 12, scale: 2, mode: "number" }).notNull(),
  costPerLiter: decimal("cost_per_liter", { precision: 10, scale: 2, mode: "number" }).notNull().default(0),
  note: varchar("note", { length: 255 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ============ ลูกค้า (ข้อมูลออกใบกำกับภาษี) ============
export const customers = mysqlTable("customers", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  taxId: varchar("tax_id", { length: 20 }).notNull().default(""),
  branch: varchar("branch", { length: 64 }).notNull().default(""), // "สำนักงานใหญ่" หรือ "สาขาที่ xxx"
  address: text("address"),
  phone: varchar("phone", { length: 20 }).notNull().default(""),
  vehiclePlate: varchar("vehicle_plate", { length: 32 }).notNull().default(""),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ============ ใบกำกับภาษีเต็มรูป ============
export const taxInvoices = mysqlTable("tax_invoices", {
  id: serial("id").primaryKey(),
  taxInvoiceNo: varchar("tax_invoice_no", { length: 32 }).notNull().unique(),
  saleId: bigint("sale_id", { mode: "number", unsigned: true }).notNull().unique(), // 1 บิล = 1 ใบกำกับเต็มรูป
  customerName: varchar("customer_name", { length: 255 }).notNull(),
  customerTaxId: varchar("customer_tax_id", { length: 20 }).notNull().default(""),
  customerBranch: varchar("customer_branch", { length: 64 }).notNull().default(""), // "สำนักงานใหญ่" หรือเลขสาขา
  customerAddress: text("customer_address"),
  customerPhone: varchar("customer_phone", { length: 20 }).notNull().default(""),
  vehiclePlate: varchar("vehicle_plate", { length: 32 }).notNull().default(""), // ไม่บังคับ (ตามแบบปั๊ม)
  issuedBy: varchar("issued_by", { length: 128 }).notNull().default(""), // พนักงานผู้ออก
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ============ ตั้งค่าร้าน ============
export const settings = mysqlTable("settings", {
  key: varchar("key", { length: 64 }).primaryKey(),
  value: mediumtext("value").notNull(), // mediumtext รองรับโลโก้ base64
});

// ============ Types ============
export type StaffUser = typeof staffUsers.$inferSelect;
export type Product = typeof products.$inferSelect;
export type Pump = typeof pumps.$inferSelect;
export type Nozzle = typeof nozzles.$inferSelect;
export type Shift = typeof shifts.$inferSelect;
export type ShiftReading = typeof shiftReadings.$inferSelect;
export type Sale = typeof sales.$inferSelect;
export type SaleItem = typeof saleItems.$inferSelect;
export type Member = typeof members.$inferSelect;
export type PointTransaction = typeof pointTransactions.$inferSelect;
export type Reward = typeof rewards.$inferSelect;
export type RewardRedemption = typeof rewardRedemptions.$inferSelect;
export type FuelTank = typeof fuelTanks.$inferSelect;
export type TankRefill = typeof tankRefills.$inferSelect;
export type TaxInvoice = typeof taxInvoices.$inferSelect;
export type Customer = typeof customers.$inferSelect;
