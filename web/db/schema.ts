import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

// ============ พนักงาน ============
export const staffUsers = sqliteTable("staff_users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  pin: text("pin").notNull(), // SHA-256 hash
  name: text("name").notNull(),
  role: text("role", { enum: ["admin", "manager", "cashier"] }).notNull().default("cashier"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// ============ ตารางงานพนักงาน & เงินเดือน ============
export const workShiftTemplates = sqliteTable("work_shift_templates", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  startTime: text("start_time").notNull(), // HH:mm
  endTime: text("end_time").notNull(), // HH:mm (น้อยกว่า start = ข้ามวัน)
  breakMinutes: integer("break_minutes").notNull().default(0),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
});

export const workSchedules = sqliteTable(
  "work_schedules",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    workDate: text("work_date").notNull(), // YYYY-MM-DD
    shiftTemplateId: integer("shift_template_id").notNull(),
    staffId: integer("staff_id").notNull(),
    status: text("status", {
      enum: ["scheduled", "completed", "leave", "absent"],
    })
      .notNull()
      .default("scheduled"),
    note: text("note"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => ({
    dateIdx: index("workschedule_date_idx").on(t.workDate),
    staffIdx: index("workschedule_staff_idx").on(t.staffId),
    assignmentUnique: uniqueIndex("workschedule_assignment_unique").on(
      t.workDate,
      t.shiftTemplateId,
      t.staffId,
    ),
  }),
);

export const employeeProfiles = sqliteTable(
  "employee_profiles",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    staffId: integer("staff_id").notNull(),
    position: text("position").notNull().default(""),
    salaryType: text("salary_type", {
      enum: ["monthly", "daily", "hourly"],
    })
      .notNull()
      .default("monthly"),
    baseRate: real("base_rate").notNull().default(0),
    overtimeRate: real("overtime_rate").notNull().default(0),
    hireDate: text("hire_date"), // YYYY-MM-DD
    note: text("note"),
  },
  (t) => ({ staffUnique: uniqueIndex("employeeprofile_staff_unique").on(t.staffId) }),
);

export const payrollRecords = sqliteTable(
  "payroll_records",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    payrollMonth: text("payroll_month").notNull(), // YYYY-MM
    staffId: integer("staff_id").notNull(),
    workDays: integer("work_days").notNull().default(0),
    workHours: real("work_hours").notNull().default(0),
    baseAmount: real("base_amount").notNull().default(0),
    overtimeHours: real("overtime_hours").notNull().default(0),
    overtimeAmount: real("overtime_amount").notNull().default(0),
    bonus: real("bonus").notNull().default(0),
    deduction: real("deduction").notNull().default(0),
    netAmount: real("net_amount").notNull().default(0),
    status: text("status", { enum: ["draft", "paid"] }).notNull().default("draft"),
    paidAt: integer("paid_at", { mode: "timestamp_ms" }),
    note: text("note"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => ({
    monthIdx: index("payroll_month_idx").on(t.payrollMonth),
    staffMonthUnique: uniqueIndex("payroll_staff_month_unique").on(
      t.staffId,
      t.payrollMonth,
    ),
  }),
);

// ============ สินค้า (น้ำมัน / 2T / อื่นๆ) ============
export const products = sqliteTable(
  "products",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    code: text("code").notNull().unique(), // GSH95, GSH91, DB7, 2T-xxx
    name: text("name").notNull(),
    category: text("category", { enum: ["fuel", "lubricant", "other"] }).notNull(),
    unit: text("unit").notNull().default("ชิ้น"), // ลิตร / ขวด / ชิ้น
    price: real("price").notNull(),
    cost: real("cost").notNull().default(0),
    stockQty: real("stock_qty").notNull().default(0),
    lowStockAt: real("low_stock_at").notNull().default(0),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => ({ catIdx: index("cat_idx").on(t.category) }),
);

// ============ ตู้จ่าย & หัวจ่าย ============
export const pumps = sqliteTable("pumps", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(), // ตู้จ่าย 1
  active: integer("active", { mode: "boolean" }).notNull().default(true),
});

export const nozzles = sqliteTable(
  "nozzles",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    pumpId: integer("pump_id").notNull(),
    productId: integer("product_id").notNull(),
    tankId: integer("tank_id"),
    label: text("label").notNull(), // ตู้ 1 - GSH95
    currentMeter: real("current_meter").notNull().default(0),
    currentMoney: real("current_money").notNull().default(0), // มิเตอร์เงินสะสม P (บาท)
    active: integer("active", { mode: "boolean" }).notNull().default(true),
  },
  (t) => ({
    pumpIdx: index("pump_idx").on(t.pumpId),
    tankIdx: index("nozzle_tank_idx").on(t.tankId),
  }),
);

// ============ กะการทำงาน ============
export const shifts = sqliteTable("shifts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  staffId: integer("staff_id"),
  staffName: text("staff_name").notNull(),
  openedAt: integer("opened_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  closedAt: integer("closed_at", { mode: "timestamp_ms" }),
  status: text("status", { enum: ["open", "closed"] }).notNull().default("open"),
  totalLiters: real("total_liters").notNull().default(0),
  totalAmount: real("total_amount").notNull().default(0),
  totalMoneyMeter: real("total_money_meter").notNull().default(0), // ยอดจากมิเตอร์เงิน P
  posAmount: real("pos_amount").notNull().default(0),
  countedCash: real("counted_cash"), // เงินสดที่นับได้จริงตอนปิดกะ (null = กะเก่าก่อนมีฟีเจอร์นี้)
  transferAmount: real("transfer_amount"), // ยอดเงินที่ลูกค้าโอนตอนปิดกะ
  openingFloat: real("opening_float").notNull().default(0), // เงินทอนเริ่มกะ
  expectedCash: real("expected_cash"), // snapshot เงินสดที่ควรมีตอนปิดกะ (null = กะเก่า)
  cashCounts: text("cash_counts"), // JSON การนับแบงก์/เหรียญตอนปิดกะ เช่น {"1000":2,"500":1}
  note: text("note"),
});

export const shiftReadings = sqliteTable(
  "shift_readings",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    shiftId: integer("shift_id").notNull(),
    nozzleId: integer("nozzle_id").notNull(),
    openMeter: real("open_meter").notNull(),
    closeMeter: real("close_meter"),
    openMoney: real("open_money").notNull().default(0), // P ตั้งต้น (บาท)
    closeMoney: real("close_money"), // P ปิดกะ (บาท)
    pricePerLiter: real("price_per_liter").notNull().default(0),
  },
  (t) => ({ shiftIdx: index("shift_idx").on(t.shiftId) }),
);

// ============ การขาย ============
export const sales = sqliteTable(
  "sales",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    receiptNo: text("receipt_no").notNull().unique(),
    shiftId: integer("shift_id"),
    staffName: text("staff_name").notNull().default(""),
    memberId: integer("member_id"),
    customerId: integer("customer_id"), // ลูกค้าเครดิต (เฉพาะบิลขายเชื่อ)
    subtotal: real("subtotal").notNull(),
    discount: real("discount").notNull().default(0),
    vatRate: real("vat_rate").notNull().default(7),
    vatAmount: real("vat_amount").notNull().default(0),
    total: real("total").notNull(),
    paymentMethod: text("payment_method", { enum: ["cash", "qr", "card", "credit"] }).notNull().default("cash"),
    received: real("received").notNull().default(0),
    changeAmt: real("change_amt").notNull().default(0),
    pointsEarned: integer("points_earned").notNull().default(0),
    pointsRedeemed: integer("points_redeemed").notNull().default(0),
    status: text("status", { enum: ["completed", "voided"] }).notNull().default("completed"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => ({ createdIdx: index("created_idx").on(t.createdAt) }),
);

export const saleItems = sqliteTable(
  "sale_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    saleId: integer("sale_id").notNull(),
    productId: integer("product_id"),
    name: text("name").notNull(),
    qty: real("qty").notNull(),
    unit: text("unit").notNull().default("ชิ้น"),
    unitPrice: real("unit_price").notNull(),
    amount: real("amount").notNull(),
  },
  (t) => ({ saleIdx: index("sale_idx").on(t.saleId) }),
);

// ============ สมาชิกสะสมแต้ม ============
export const members = sqliteTable("members", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  memberCode: text("member_code").notNull().unique(),
  name: text("name").notNull(),
  phone: text("phone").notNull().unique(),
  points: integer("points").notNull().default(0),
  tier: text("tier", { enum: ["silver", "gold", "platinum"] }).notNull().default("silver"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const pointTransactions = sqliteTable(
  "point_transactions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    memberId: integer("member_id").notNull(),
    saleId: integer("sale_id"),
    type: text("type", { enum: ["earn", "redeem", "adjust"] }).notNull(),
    points: integer("points").notNull(),
    note: text("note"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => ({ memberIdx: index("member_idx").on(t.memberId) }),
);

export const rewards = sqliteTable("rewards", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  pointsRequired: integer("points_required").notNull(),
  stock: integer("stock").notNull().default(0),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
});

export const rewardRedemptions = sqliteTable("reward_redemptions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  memberId: integer("member_id").notNull(),
  rewardId: integer("reward_id").notNull(),
  pointsUsed: integer("points_used").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// ============ ถังน้ำมัน ============
export const fuelTanks = sqliteTable("fuel_tanks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  productId: integer("product_id").notNull(),
  name: text("name").notNull(), // ถัง GSH95
  capacityLiters: real("capacity_liters").notNull(),
  currentLiters: real("current_liters").notNull().default(0),
  lowAlertAt: real("low_alert_at").notNull().default(0),
});

export const tankRefills = sqliteTable("tank_refills", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tankId: integer("tank_id").notNull(),
  liters: real("liters").notNull(),
  costPerLiter: real("cost_per_liter").notNull().default(0),
  note: text("note"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// ============ ลูกค้า (ข้อมูลออกใบกำกับภาษี) ============
export const customers = sqliteTable("customers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  taxId: text("tax_id").notNull().default(""),
  branch: text("branch").notNull().default(""), // "สำนักงานใหญ่" หรือ "สาขาที่ xxx"
  address: text("address"),
  phone: text("phone").notNull().default(""),
  vehiclePlate: text("vehicle_plate").notNull().default(""),
  creditLimit: real("credit_limit").notNull().default(0), // วงเงินเครดิต (0 = ไม่จำกัด)
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// ============ ใบกำกับภาษีเต็มรูป ============
export const taxInvoices = sqliteTable("tax_invoices", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  taxInvoiceNo: text("tax_invoice_no").notNull().unique(),
  saleId: integer("sale_id").notNull().unique(), // 1 บิล = 1 ใบกำกับเต็มรูป
  customerName: text("customer_name").notNull(),
  customerTaxId: text("customer_tax_id").notNull().default(""),
  customerBranch: text("customer_branch").notNull().default(""), // "สำนักงานใหญ่" หรือเลขสาขา
  customerAddress: text("customer_address"),
  customerPhone: text("customer_phone").notNull().default(""),
  vehiclePlate: text("vehicle_plate").notNull().default(""), // ไม่บังคับ (ตามแบบปั๊ม)
  issuedBy: text("issued_by").notNull().default(""), // พนักงานผู้ออก
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// ============ ขายเชื่อ — การรับชำระหนี้ ============
export const debtPayments = sqliteTable(
  "debt_payments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    paymentNo: text("payment_no").notNull().unique(), // เลขที่ใบรับชำระ เช่น P00001
    customerId: integer("customer_id").notNull(),
    amount: real("amount").notNull(),
    method: text("method", { enum: ["cash", "qr", "transfer"] }).notNull().default("cash"),
    shiftId: integer("shift_id"), // กะที่เปิดอยู่ตอนรับชำระ (ถ้ามี)
    staffName: text("staff_name").notNull().default(""),
    note: text("note"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => ({
    customerIdx: index("debtpay_customer_idx").on(t.customerId),
    createdIdx: index("debtpay_created_idx").on(t.createdAt),
  }),
);

// ============ ค่าใช้จ่ายหน้าร้าน ============
export const expenses = sqliteTable(
  "expenses",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    title: text("title").notNull(),
    category: text("category").notNull().default(""),
    amount: real("amount").notNull(),
    shiftId: integer("shift_id"), // กะที่เปิดอยู่ตอนบันทึก (ถ้ามี)
    staffName: text("staff_name").notNull().default(""),
    note: text("note"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => ({ createdIdx: index("expenses_created_idx").on(t.createdAt) }),
);

// ============ ประวัติเปลี่ยนราคาสินค้า ============
export const priceChanges = sqliteTable(
  "price_changes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    productId: integer("product_id"), // nullable — เก็บประวัติไว้แม้ลบสินค้า
    productCode: text("product_code").notNull().default(""),
    productName: text("product_name").notNull().default(""),
    oldPrice: real("old_price").notNull(),
    newPrice: real("new_price").notNull(),
    changedBy: text("changed_by").notNull().default(""),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => ({ productIdx: index("pricechg_product_idx").on(t.productId) }),
);

// ============ Audit log ============
export const auditLogs = sqliteTable(
  "audit_logs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    action: text("action").notNull(), // เช่น void_sale, update_price, adjust_points
    actorId: integer("actor_id"),
    actorName: text("actor_name").notNull().default(""),
    detail: text("detail").notNull().default(""),
    refType: text("ref_type"),
    refId: integer("ref_id"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => ({
    actionIdx: index("audit_action_idx").on(t.action),
    createdIdx: index("audit_created_idx").on(t.createdAt),
  }),
);

// ============ ตั้งค่าร้าน ============
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(), // รองรับโลโก้ base64
});

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
