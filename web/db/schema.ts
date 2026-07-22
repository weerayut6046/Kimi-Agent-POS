import {
  pgSchema,
  text,
  integer,
  boolean,
  timestamp,
  numeric,
  jsonb,
  uuid,
  index,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import type { MenuPermissionKey } from "@contracts/menuPermissions";

// Keep application tables outside Supabase's exposed `public` schema.
export const posSchema = pgSchema("pos");

// ============ กลุ่มสิทธิ์เมนู ============
export const staffAccessGroups = posSchema.table("staff_access_groups", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  name: text("name").notNull().unique(),
  description: text("description").notNull().default(""),
  role: text("role", { enum: ["manager", "cashier"] }).notNull(),
  menuPermissions: jsonb("menu_permissions").$type<MenuPermissionKey[]>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

// ============ พนักงาน ============
export const staffUsers = posSchema.table(
  "staff_users",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    username: text("username").notNull().unique(),
    pin: text("pin").notNull(), // SHA-256 hash
    name: text("name").notNull(),
    role: text("role", { enum: ["admin", "manager", "cashier"] }).notNull().default("cashier"),
    accessGroupId: integer("access_group_id").references(
      () => staffAccessGroups.id,
      { onDelete: "set null" },
    ),
    menuPermissions: jsonb("menu_permissions").$type<MenuPermissionKey[]>(),
    supabaseAuthUserId: uuid("supabase_auth_user_id").unique(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull().defaultNow(),
  },
  (t) => ({
    accessGroupIdx: index("staffuser_access_group_idx").on(t.accessGroupId),
  }),
).enableRLS();

// ============ ตารางงานพนักงาน & เงินเดือน ============
export const workShiftTemplates = posSchema.table("work_shift_templates", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  name: text("name").notNull(),
  startTime: text("start_time").notNull(), // HH:mm
  endTime: text("end_time").notNull(), // HH:mm (น้อยกว่า start = ข้ามวัน)
  breakMinutes: integer("break_minutes").notNull().default(0),
  active: boolean("active").notNull().default(true),
}).enableRLS();

export const workSchedules = posSchema.table(
  "work_schedules",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    workDate: text("work_date").notNull(), // YYYY-MM-DD
    shiftTemplateId: integer("shift_template_id")
      .notNull()
      .references(() => workShiftTemplates.id, { onDelete: "restrict" }),
    staffId: integer("staff_id")
      .notNull()
      .references(() => staffUsers.id, { onDelete: "cascade" }),
    status: text("status", {
      enum: ["scheduled", "completed", "leave", "absent"],
    })
      .notNull()
      .default("scheduled"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull().defaultNow(),
  },
  (t) => ({
    dateIdx: index("workschedule_date_idx").on(t.workDate),
    staffIdx: index("workschedule_staff_idx").on(t.staffId),
    templateIdx: index("workschedule_template_idx").on(t.shiftTemplateId),
    assignmentUnique: uniqueIndex("workschedule_assignment_unique").on(
      t.workDate,
      t.shiftTemplateId,
      t.staffId,
    ),
  }),
).enableRLS();

export const employeeProfiles = posSchema.table(
  "employee_profiles",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    staffId: integer("staff_id")
      .notNull()
      .references(() => staffUsers.id, { onDelete: "cascade" }),
    position: text("position").notNull().default(""),
    salaryType: text("salary_type", {
      enum: ["monthly", "daily", "hourly"],
    })
      .notNull()
      .default("monthly"),
    baseRate: numeric("base_rate", { precision: 18, scale: 3, mode: "number" }).notNull().default(0),
    overtimeRate: numeric("overtime_rate", { precision: 18, scale: 3, mode: "number" }).notNull().default(0),
    hireDate: text("hire_date"), // YYYY-MM-DD
    note: text("note"),
  },
  (t) => ({ staffUnique: uniqueIndex("employeeprofile_staff_unique").on(t.staffId) }),
).enableRLS();

export const payrollRecords = posSchema.table(
  "payroll_records",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    payrollMonth: text("payroll_month").notNull(), // YYYY-MM
    staffId: integer("staff_id")
      .notNull()
      .references(() => staffUsers.id, { onDelete: "restrict" }),
    workDays: integer("work_days").notNull().default(0),
    workHours: numeric("work_hours", { precision: 18, scale: 3, mode: "number" }).notNull().default(0),
    baseAmount: numeric("base_amount", { precision: 18, scale: 3, mode: "number" }).notNull().default(0),
    overtimeHours: numeric("overtime_hours", { precision: 18, scale: 3, mode: "number" }).notNull().default(0),
    overtimeAmount: numeric("overtime_amount", { precision: 18, scale: 3, mode: "number" }).notNull().default(0),
    bonus: numeric("bonus", { precision: 18, scale: 3, mode: "number" }).notNull().default(0),
    deduction: numeric("deduction", { precision: 18, scale: 3, mode: "number" }).notNull().default(0),
    netAmount: numeric("net_amount", { precision: 18, scale: 3, mode: "number" }).notNull().default(0),
    status: text("status", { enum: ["draft", "paid"] }).notNull().default("draft"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull().defaultNow(),
  },
  (t) => ({
    monthIdx: index("payroll_month_idx").on(t.payrollMonth),
    staffMonthUnique: uniqueIndex("payroll_staff_month_unique").on(
      t.staffId,
      t.payrollMonth,
    ),
  }),
).enableRLS();

// ============ สินค้า (น้ำมัน / 2T / อื่นๆ) ============
export const products = posSchema.table(
  "products",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    code: text("code").notNull().unique(), // GSH95, GSH91, DB7, 2T-xxx
    name: text("name").notNull(),
    category: text("category", { enum: ["fuel", "lubricant", "other"] }).notNull(),
    unit: text("unit").notNull().default("ชิ้น"), // ลิตร / ขวด / ชิ้น
    price: numeric("price", { precision: 18, scale: 3, mode: "number" }).notNull(),
    cost: numeric("cost", { precision: 18, scale: 3, mode: "number" }).notNull().default(0),
    stockQty: numeric("stock_qty", { precision: 18, scale: 3, mode: "number" }).notNull().default(0),
    lowStockAt: numeric("low_stock_at", { precision: 18, scale: 3, mode: "number" }).notNull().default(0),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull().defaultNow(),
  },
  (t) => ({ catIdx: index("cat_idx").on(t.category) }),
).enableRLS();

// ============ ตู้จ่าย & หัวจ่าย ============
export const pumps = posSchema.table("pumps", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  name: text("name").notNull(), // ตู้จ่าย 1
  active: boolean("active").notNull().default(true),
}).enableRLS();

export const nozzles = posSchema.table(
  "nozzles",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    pumpId: integer("pump_id")
      .notNull()
      .references(() => pumps.id, { onDelete: "restrict" }),
    productId: integer("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "restrict" }),
    tankId: integer("tank_id").references(
      (): AnyPgColumn => fuelTanks.id,
      { onDelete: "set null" },
    ),
    label: text("label").notNull(), // ตู้ 1 - GSH95
    currentMeter: numeric("current_meter", { precision: 18, scale: 3, mode: "number" }).notNull().default(0),
    currentMoney: numeric("current_money", { precision: 18, scale: 3, mode: "number" }).notNull().default(0), // มิเตอร์เงินสะสม P (บาท)
    active: boolean("active").notNull().default(true),
  },
  (t) => ({
    pumpIdx: index("pump_idx").on(t.pumpId),
    productIdx: index("nozzle_product_idx").on(t.productId),
    tankIdx: index("nozzle_tank_idx").on(t.tankId),
  }),
).enableRLS();

// ============ กะการทำงาน ============
export const shifts = posSchema.table("shifts", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  staffId: integer("staff_id").references(() => staffUsers.id, { onDelete: "set null" }),
  staffName: text("staff_name").notNull(),
  openedAt: timestamp("opened_at", { withTimezone: true })
    .notNull().defaultNow(),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  status: text("status", { enum: ["open", "closed"] }).notNull().default("open"),
  totalLiters: numeric("total_liters", { precision: 18, scale: 3, mode: "number" }).notNull().default(0),
  totalAmount: numeric("total_amount", { precision: 18, scale: 3, mode: "number" }).notNull().default(0),
  totalMoneyMeter: numeric("total_money_meter", { precision: 18, scale: 3, mode: "number" }).notNull().default(0), // ยอดจากมิเตอร์เงิน P
  posAmount: numeric("pos_amount", { precision: 18, scale: 3, mode: "number" }).notNull().default(0),
  countedCash: numeric("counted_cash", { precision: 18, scale: 3, mode: "number" }), // เงินสดที่นับได้จริงตอนปิดกะ (null = กะเก่าก่อนมีฟีเจอร์นี้)
  transferAmount: numeric("transfer_amount", { precision: 18, scale: 3, mode: "number" }), // ยอดเงินที่ลูกค้าโอนตอนปิดกะ
  openingFloat: numeric("opening_float", { precision: 18, scale: 3, mode: "number" }).notNull().default(0), // เงินทอนเริ่มกะ
  expectedCash: numeric("expected_cash", { precision: 18, scale: 3, mode: "number" }), // snapshot เงินสดที่ควรมีตอนปิดกะ (null = กะเก่า)
  cashCounts: text("cash_counts"), // JSON การนับแบงก์/เหรียญตอนปิดกะ เช่น {"1000":2,"500":1}
  note: text("note"),
}, (t) => ({
  staffIdx: index("shift_staff_idx").on(t.staffId),
  statusIdx: index("shift_status_idx").on(t.status),
})).enableRLS();

export const shiftReadings = posSchema.table(
  "shift_readings",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    shiftId: integer("shift_id")
      .notNull()
      .references(() => shifts.id, { onDelete: "cascade" }),
    nozzleId: integer("nozzle_id")
      .notNull()
      .references(() => nozzles.id, { onDelete: "restrict" }),
    openMeter: numeric("open_meter", { precision: 18, scale: 3, mode: "number" }).notNull(),
    closeMeter: numeric("close_meter", { precision: 18, scale: 3, mode: "number" }),
    openMoney: numeric("open_money", { precision: 18, scale: 3, mode: "number" }).notNull().default(0), // P ตั้งต้น (บาท)
    closeMoney: numeric("close_money", { precision: 18, scale: 3, mode: "number" }), // P ปิดกะ (บาท)
    pricePerLiter: numeric("price_per_liter", { precision: 18, scale: 3, mode: "number" }).notNull().default(0),
  },
  (t) => ({
    shiftIdx: index("shift_idx").on(t.shiftId),
    nozzleIdx: index("shiftreading_nozzle_idx").on(t.nozzleId),
  }),
).enableRLS();

// ============ การขาย ============
export const sales = posSchema.table(
  "sales",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    receiptNo: text("receipt_no").notNull().unique(),
    shiftId: integer("shift_id").references(() => shifts.id, { onDelete: "set null" }),
    staffName: text("staff_name").notNull().default(""),
    memberId: integer("member_id").references(
      (): AnyPgColumn => members.id,
      { onDelete: "set null" },
    ),
    customerId: integer("customer_id").references(
      (): AnyPgColumn => customers.id,
      { onDelete: "set null" },
    ), // ลูกค้าเครดิต (เฉพาะบิลขายเชื่อ)
    subtotal: numeric("subtotal", { precision: 18, scale: 3, mode: "number" }).notNull(),
    discount: numeric("discount", { precision: 18, scale: 3, mode: "number" }).notNull().default(0),
    vatRate: numeric("vat_rate", { precision: 18, scale: 3, mode: "number" }).notNull().default(7),
    vatAmount: numeric("vat_amount", { precision: 18, scale: 3, mode: "number" }).notNull().default(0),
    total: numeric("total", { precision: 18, scale: 3, mode: "number" }).notNull(),
    paymentMethod: text("payment_method", { enum: ["cash", "qr", "card", "credit"] }).notNull().default("cash"),
    received: numeric("received", { precision: 18, scale: 3, mode: "number" }).notNull().default(0),
    changeAmt: numeric("change_amt", { precision: 18, scale: 3, mode: "number" }).notNull().default(0),
    pointsEarned: integer("points_earned").notNull().default(0),
    pointsRedeemed: integer("points_redeemed").notNull().default(0),
    status: text("status", { enum: ["completed", "voided"] }).notNull().default("completed"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull().defaultNow(),
  },
  (t) => ({
    createdIdx: index("created_idx").on(t.createdAt),
    shiftIdx: index("sales_shift_idx").on(t.shiftId),
    memberIdx: index("sales_member_idx").on(t.memberId),
    customerIdx: index("sales_customer_idx").on(t.customerId),
    statusIdx: index("sales_status_idx").on(t.status),
  }),
).enableRLS();

export const saleItems = posSchema.table(
  "sale_items",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    saleId: integer("sale_id")
      .notNull()
      .references(() => sales.id, { onDelete: "cascade" }),
    productId: integer("product_id").references(() => products.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    qty: numeric("qty", { precision: 18, scale: 3, mode: "number" }).notNull(),
    unit: text("unit").notNull().default("ชิ้น"),
    unitPrice: numeric("unit_price", { precision: 18, scale: 3, mode: "number" }).notNull(),
    amount: numeric("amount", { precision: 18, scale: 3, mode: "number" }).notNull(),
  },
  (t) => ({
    saleIdx: index("sale_idx").on(t.saleId),
    productIdx: index("saleitem_product_idx").on(t.productId),
  }),
).enableRLS();

// ============ สมาชิกสะสมแต้ม ============
export const members = posSchema.table("members", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  memberCode: text("member_code").notNull().unique(),
  name: text("name").notNull(),
  phone: text("phone").notNull().unique(),
  points: integer("points").notNull().default(0),
  tier: text("tier", { enum: ["silver", "gold", "platinum"] }).notNull().default("silver"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull().defaultNow(),
}).enableRLS();

export const pointTransactions = posSchema.table(
  "point_transactions",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    memberId: integer("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    saleId: integer("sale_id").references(() => sales.id, { onDelete: "set null" }),
    type: text("type", { enum: ["earn", "redeem", "adjust"] }).notNull(),
    points: integer("points").notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull().defaultNow(),
  },
  (t) => ({
    memberIdx: index("member_idx").on(t.memberId),
    saleIdx: index("pointtransaction_sale_idx").on(t.saleId),
  }),
).enableRLS();

export const rewards = posSchema.table("rewards", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  name: text("name").notNull(),
  pointsRequired: integer("points_required").notNull(),
  stock: integer("stock").notNull().default(0),
  active: boolean("active").notNull().default(true),
}).enableRLS();

export const rewardRedemptions = posSchema.table(
  "reward_redemptions",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    memberId: integer("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    rewardId: integer("reward_id")
      .notNull()
      .references(() => rewards.id, { onDelete: "restrict" }),
    pointsUsed: integer("points_used").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull().defaultNow(),
  },
  (t) => ({
    memberIdx: index("rewardredemption_member_idx").on(t.memberId),
    rewardIdx: index("rewardredemption_reward_idx").on(t.rewardId),
  }),
).enableRLS();

// ============ ถังน้ำมัน ============
export const fuelTanks = posSchema.table(
  "fuel_tanks",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    productId: integer("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "restrict" }),
    name: text("name").notNull(), // ถัง GSH95
    capacityLiters: numeric("capacity_liters", { precision: 18, scale: 3, mode: "number" }).notNull(),
    currentLiters: numeric("current_liters", { precision: 18, scale: 3, mode: "number" }).notNull().default(0),
    lowAlertAt: numeric("low_alert_at", { precision: 18, scale: 3, mode: "number" }).notNull().default(0),
  },
  (t) => ({ productIdx: index("fueltank_product_idx").on(t.productId) }),
).enableRLS();

export const tankRefills = posSchema.table(
  "tank_refills",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    tankId: integer("tank_id")
      .notNull()
      .references(() => fuelTanks.id, { onDelete: "cascade" }),
    liters: numeric("liters", { precision: 18, scale: 3, mode: "number" }).notNull(),
    costPerLiter: numeric("cost_per_liter", { precision: 18, scale: 3, mode: "number" }).notNull().default(0),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull().defaultNow(),
  },
  (t) => ({ tankIdx: index("tankrefill_tank_idx").on(t.tankId) }),
).enableRLS();

// ============ ลูกค้า (ข้อมูลออกใบกำกับภาษี) ============
export const customers = posSchema.table("customers", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  name: text("name").notNull(),
  taxId: text("tax_id").notNull().default(""),
  branch: text("branch").notNull().default(""), // "สำนักงานใหญ่" หรือ "สาขาที่ xxx"
  address: text("address"),
  phone: text("phone").notNull().default(""),
  vehiclePlate: text("vehicle_plate").notNull().default(""),
  creditLimit: numeric("credit_limit", { precision: 18, scale: 3, mode: "number" }).notNull().default(0), // วงเงินเครดิต (0 = ไม่จำกัด)
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull().defaultNow(),
}).enableRLS();

// ============ ใบกำกับภาษีเต็มรูป ============
export const taxInvoices = posSchema.table("tax_invoices", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  taxInvoiceNo: text("tax_invoice_no").notNull().unique(),
  saleId: integer("sale_id")
    .notNull()
    .unique()
    .references(() => sales.id, { onDelete: "cascade" }), // 1 บิล = 1 ใบกำกับเต็มรูป
  customerName: text("customer_name").notNull(),
  customerTaxId: text("customer_tax_id").notNull().default(""),
  customerBranch: text("customer_branch").notNull().default(""), // "สำนักงานใหญ่" หรือเลขสาขา
  customerAddress: text("customer_address"),
  customerPhone: text("customer_phone").notNull().default(""),
  vehiclePlate: text("vehicle_plate").notNull().default(""), // ไม่บังคับ (ตามแบบปั๊ม)
  issuedBy: text("issued_by").notNull().default(""), // พนักงานผู้ออก
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull().defaultNow(),
}).enableRLS();

// ============ ขายเชื่อ — การรับชำระหนี้ ============
export const debtPayments = posSchema.table(
  "debt_payments",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    paymentNo: text("payment_no").notNull().unique(), // เลขที่ใบรับชำระ เช่น P00001
    customerId: integer("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    amount: numeric("amount", { precision: 18, scale: 3, mode: "number" }).notNull(),
    method: text("method", { enum: ["cash", "qr", "transfer"] }).notNull().default("cash"),
    shiftId: integer("shift_id").references(() => shifts.id, { onDelete: "set null" }), // กะที่เปิดอยู่ตอนรับชำระ (ถ้ามี)
    staffName: text("staff_name").notNull().default(""),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull().defaultNow(),
  },
  (t) => ({
    customerIdx: index("debtpay_customer_idx").on(t.customerId),
    shiftIdx: index("debtpay_shift_idx").on(t.shiftId),
    createdIdx: index("debtpay_created_idx").on(t.createdAt),
  }),
).enableRLS();

// ============ ค่าใช้จ่ายหน้าร้าน ============
export const expenses = posSchema.table(
  "expenses",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    title: text("title").notNull(),
    category: text("category").notNull().default(""),
    amount: numeric("amount", { precision: 18, scale: 3, mode: "number" }).notNull(),
    shiftId: integer("shift_id").references(() => shifts.id, { onDelete: "set null" }), // กะที่เปิดอยู่ตอนบันทึก (ถ้ามี)
    staffName: text("staff_name").notNull().default(""),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull().defaultNow(),
  },
  (t) => ({
    createdIdx: index("expenses_created_idx").on(t.createdAt),
    shiftIdx: index("expenses_shift_idx").on(t.shiftId),
  }),
).enableRLS();

// ============ ประวัติเปลี่ยนราคาสินค้า ============
export const priceChanges = posSchema.table(
  "price_changes",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    productId: integer("product_id").references(() => products.id, { onDelete: "set null" }), // nullable — เก็บประวัติไว้แม้ลบสินค้า
    productCode: text("product_code").notNull().default(""),
    productName: text("product_name").notNull().default(""),
    oldPrice: numeric("old_price", { precision: 18, scale: 3, mode: "number" }).notNull(),
    newPrice: numeric("new_price", { precision: 18, scale: 3, mode: "number" }).notNull(),
    changedBy: text("changed_by").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull().defaultNow(),
  },
  (t) => ({ productIdx: index("pricechg_product_idx").on(t.productId) }),
).enableRLS();

// ============ Audit log ============
export const auditLogs = posSchema.table(
  "audit_logs",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    action: text("action").notNull(), // เช่น void_sale, update_price, adjust_points
    actorId: integer("actor_id").references(() => staffUsers.id, { onDelete: "set null" }),
    actorName: text("actor_name").notNull().default(""),
    detail: text("detail").notNull().default(""),
    refType: text("ref_type"),
    refId: integer("ref_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull().defaultNow(),
  },
  (t) => ({
    actionIdx: index("audit_action_idx").on(t.action),
    actorIdx: index("audit_actor_idx").on(t.actorId),
    createdIdx: index("audit_created_idx").on(t.createdAt),
  }),
).enableRLS();

// ============ ตั้งค่าร้าน ============
export const settings = posSchema.table("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(), // รองรับโลโก้ base64
}).enableRLS();

// ============ Types ============
export type StaffUser = typeof staffUsers.$inferSelect;
export type WorkShiftTemplate = typeof workShiftTemplates.$inferSelect;
export type WorkSchedule = typeof workSchedules.$inferSelect;
export type EmployeeProfile = typeof employeeProfiles.$inferSelect;
export type PayrollRecord = typeof payrollRecords.$inferSelect;
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
export type DebtPayment = typeof debtPayments.$inferSelect;
export type Expense = typeof expenses.$inferSelect;
export type PriceChange = typeof priceChanges.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;
