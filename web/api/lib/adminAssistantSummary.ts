import { and, eq, gte, lt, sql } from "drizzle-orm";
import {
  auditLogs,
  customers,
  debtPayments,
  expenses,
  fuelTanks,
  members,
  nozzles,
  payrollRecords,
  priceChanges,
  products,
  pumps,
  rewards,
  sales,
  settings,
  staffUsers,
  taxInvoices,
  workSchedules,
  workShiftTemplates,
} from "@db/schema";
import { getDb } from "../queries/connection";

export const ADMIN_BUSINESS_SECTIONS = [
  "all",
  "finance",
  "customers",
  "workforce",
  "documents",
  "system",
  "audit",
] as const;

export type AdminBusinessSection = (typeof ADMIN_BUSINESS_SECTIONS)[number];

type CountTotal = { count: number; total: number };
type GroupCount = { key: string; count: number };
type GroupCountTotal = GroupCount & { total: number };

type FinanceSummary = {
  section: "finance";
  today: { sales: CountTotal; expenses: CountTotal };
  currentMonth: {
    sales: CountTotal;
    expenses: CountTotal;
    expenseCategories: GroupCountTotal[];
  };
};

type CustomerSummary = {
  section: "customers";
  members: { total: number; byTier: GroupCount[] };
  businessCustomers: number;
  credit: {
    debtorCount: number;
    outstandingTotal: number;
    paymentsCurrentMonth: CountTotal;
  };
};

type WorkforceSummary = {
  section: "workforce";
  activeStaffByRole: GroupCount[];
  activeShiftTemplates: number;
  todaySchedules: GroupCount[];
  currentMonthPayroll: GroupCountTotal[];
};

type DocumentSummary = {
  section: "documents";
  taxInvoicesToday: CountTotal;
  taxInvoicesCurrentMonth: CountTotal;
  salesCurrentMonthByStatus: GroupCountTotal[];
  priceChangesCurrentMonth: number;
};

type SystemSummary = {
  section: "system";
  activeProductsByCategory: GroupCount[];
  activePumps: number;
  activeNozzles: number;
  fuelTanks: number;
  activeRewards: number;
  configuredSettings: number;
};

type AuditSummary = {
  section: "audit";
  todayActions: GroupCount[];
};

type SingleAdminBusinessSummary =
  | FinanceSummary
  | CustomerSummary
  | WorkforceSummary
  | DocumentSummary
  | SystemSummary
  | AuditSummary;

export type AdminBusinessSummary =
  | SingleAdminBusinessSummary
  | { section: "all"; summaries: SingleAdminBusinessSummary[] };

function bangkokRanges(now = new Date()) {
  const offsetMs = 7 * 60 * 60 * 1_000;
  const bangkokNow = new Date(now.getTime() + offsetMs);
  const year = bangkokNow.getUTCFullYear();
  const month = bangkokNow.getUTCMonth();
  const date = bangkokNow.getUTCDate();
  const utcAtBangkokMidnight = (
    targetYear: number,
    targetMonth: number,
    targetDate: number
  ) => new Date(Date.UTC(targetYear, targetMonth, targetDate) - offsetMs);
  return {
    todayStart: utcAtBangkokMidnight(year, month, date),
    tomorrowStart: utcAtBangkokMidnight(year, month, date + 1),
    monthStart: utcAtBangkokMidnight(year, month, 1),
    nextMonthStart: utcAtBangkokMidnight(year, month + 1, 1),
    dateKey: bangkokNow.toISOString().slice(0, 10),
    monthKey: bangkokNow.toISOString().slice(0, 7),
  };
}

function countTotal(
  row: { count: number; total: number } | undefined
): CountTotal {
  return { count: Number(row?.count ?? 0), total: Number(row?.total ?? 0) };
}

async function queryFinance(): Promise<FinanceSummary> {
  const db = getDb();
  const range = bangkokRanges();
  const salesAggregate = (start: Date, end: Date) =>
    db
      .select({
        count: sql<number>`count(*)`,
        total: sql<number>`coalesce(sum(${sales.total}), 0)`,
      })
      .from(sales)
      .where(
        and(
          gte(sales.createdAt, start),
          lt(sales.createdAt, end),
          eq(sales.status, "completed")
        )
      );
  const expenseAggregate = (start: Date, end: Date) =>
    db
      .select({
        count: sql<number>`count(*)`,
        total: sql<number>`coalesce(sum(${expenses.amount}), 0)`,
      })
      .from(expenses)
      .where(and(gte(expenses.createdAt, start), lt(expenses.createdAt, end)));

  const [salesToday, expensesToday, salesMonth, expensesMonth, categories] =
    await Promise.all([
      salesAggregate(range.todayStart, range.tomorrowStart),
      expenseAggregate(range.todayStart, range.tomorrowStart),
      salesAggregate(range.monthStart, range.nextMonthStart),
      expenseAggregate(range.monthStart, range.nextMonthStart),
      db
        .select({
          key: expenses.category,
          count: sql<number>`count(*)`,
          total: sql<number>`coalesce(sum(${expenses.amount}), 0)`,
        })
        .from(expenses)
        .where(
          and(
            gte(expenses.createdAt, range.monthStart),
            lt(expenses.createdAt, range.nextMonthStart)
          )
        )
        .groupBy(expenses.category),
    ]);

  return {
    section: "finance",
    today: {
      sales: countTotal(salesToday[0]),
      expenses: countTotal(expensesToday[0]),
    },
    currentMonth: {
      sales: countTotal(salesMonth[0]),
      expenses: countTotal(expensesMonth[0]),
      expenseCategories: categories.map(row => ({
        key: row.key || "ไม่ระบุหมวด",
        count: Number(row.count),
        total: Number(row.total),
      })),
    },
  };
}

async function queryCustomers(): Promise<CustomerSummary> {
  const db = getDb();
  const range = bangkokRanges();
  const [memberTiers, customerCount, creditRows, paymentRows, monthPayments] =
    await Promise.all([
      db
        .select({ key: members.tier, count: sql<number>`count(*)` })
        .from(members)
        .groupBy(members.tier),
      db.select({ count: sql<number>`count(*)` }).from(customers),
      db
        .select({
          customerId: sales.customerId,
          total: sql<number>`coalesce(sum(${sales.total}), 0)`,
        })
        .from(sales)
        .where(
          and(eq(sales.status, "completed"), eq(sales.paymentMethod, "credit"))
        )
        .groupBy(sales.customerId),
      db
        .select({
          customerId: debtPayments.customerId,
          total: sql<number>`coalesce(sum(${debtPayments.amount}), 0)`,
        })
        .from(debtPayments)
        .groupBy(debtPayments.customerId),
      db
        .select({
          count: sql<number>`count(*)`,
          total: sql<number>`coalesce(sum(${debtPayments.amount}), 0)`,
        })
        .from(debtPayments)
        .where(
          and(
            gte(debtPayments.createdAt, range.monthStart),
            lt(debtPayments.createdAt, range.nextMonthStart)
          )
        ),
    ]);
  const paymentsByCustomer = new Map(
    paymentRows.map(row => [row.customerId, Number(row.total)])
  );
  const outstanding = creditRows
    .filter(row => row.customerId !== null)
    .map(row =>
      Math.max(
        0,
        Number(row.total) - (paymentsByCustomer.get(row.customerId!) ?? 0)
      )
    )
    .filter(amount => amount > 0);

  return {
    section: "customers",
    members: {
      total: memberTiers.reduce((sum, row) => sum + Number(row.count), 0),
      byTier: memberTiers.map(row => ({
        key: row.key,
        count: Number(row.count),
      })),
    },
    businessCustomers: Number(customerCount[0]?.count ?? 0),
    credit: {
      debtorCount: outstanding.length,
      outstandingTotal: outstanding.reduce((sum, amount) => sum + amount, 0),
      paymentsCurrentMonth: countTotal(monthPayments[0]),
    },
  };
}

async function queryWorkforce(): Promise<WorkforceSummary> {
  const db = getDb();
  const range = bangkokRanges();
  const [staffByRole, templateCount, schedulesToday, payrollMonth] =
    await Promise.all([
      db
        .select({ key: staffUsers.role, count: sql<number>`count(*)` })
        .from(staffUsers)
        .where(eq(staffUsers.active, true))
        .groupBy(staffUsers.role),
      db
        .select({ count: sql<number>`count(*)` })
        .from(workShiftTemplates)
        .where(eq(workShiftTemplates.active, true)),
      db
        .select({ key: workSchedules.status, count: sql<number>`count(*)` })
        .from(workSchedules)
        .where(eq(workSchedules.workDate, range.dateKey))
        .groupBy(workSchedules.status),
      db
        .select({
          key: payrollRecords.status,
          count: sql<number>`count(*)`,
          total: sql<number>`coalesce(sum(${payrollRecords.netAmount}), 0)`,
        })
        .from(payrollRecords)
        .where(eq(payrollRecords.payrollMonth, range.monthKey))
        .groupBy(payrollRecords.status),
    ]);
  return {
    section: "workforce",
    activeStaffByRole: staffByRole.map(row => ({
      key: row.key,
      count: Number(row.count),
    })),
    activeShiftTemplates: Number(templateCount[0]?.count ?? 0),
    todaySchedules: schedulesToday.map(row => ({
      key: row.key,
      count: Number(row.count),
    })),
    currentMonthPayroll: payrollMonth.map(row => ({
      key: row.key,
      count: Number(row.count),
      total: Number(row.total),
    })),
  };
}

async function queryDocuments(): Promise<DocumentSummary> {
  const db = getDb();
  const range = bangkokRanges();
  const taxAggregate = (start: Date, end: Date) =>
    db
      .select({
        count: sql<number>`count(*)`,
        total: sql<number>`coalesce(sum(${sales.total}), 0)`,
      })
      .from(taxInvoices)
      .innerJoin(sales, eq(taxInvoices.saleId, sales.id))
      .where(
        and(gte(taxInvoices.createdAt, start), lt(taxInvoices.createdAt, end))
      );
  const [taxToday, taxMonth, salesStatuses, priceChangeCount] =
    await Promise.all([
      taxAggregate(range.todayStart, range.tomorrowStart),
      taxAggregate(range.monthStart, range.nextMonthStart),
      db
        .select({
          key: sales.status,
          count: sql<number>`count(*)`,
          total: sql<number>`coalesce(sum(${sales.total}), 0)`,
        })
        .from(sales)
        .where(
          and(
            gte(sales.createdAt, range.monthStart),
            lt(sales.createdAt, range.nextMonthStart)
          )
        )
        .groupBy(sales.status),
      db
        .select({ count: sql<number>`count(*)` })
        .from(priceChanges)
        .where(
          and(
            gte(priceChanges.createdAt, range.monthStart),
            lt(priceChanges.createdAt, range.nextMonthStart)
          )
        ),
    ]);
  return {
    section: "documents",
    taxInvoicesToday: countTotal(taxToday[0]),
    taxInvoicesCurrentMonth: countTotal(taxMonth[0]),
    salesCurrentMonthByStatus: salesStatuses.map(row => ({
      key: row.key,
      count: Number(row.count),
      total: Number(row.total),
    })),
    priceChangesCurrentMonth: Number(priceChangeCount[0]?.count ?? 0),
  };
}

async function querySystem(): Promise<SystemSummary> {
  const db = getDb();
  const [
    productGroups,
    pumpCount,
    nozzleCount,
    tankCount,
    rewardCount,
    settingCount,
  ] = await Promise.all([
    db
      .select({ key: products.category, count: sql<number>`count(*)` })
      .from(products)
      .where(eq(products.active, true))
      .groupBy(products.category),
    db
      .select({ count: sql<number>`count(*)` })
      .from(pumps)
      .where(eq(pumps.active, true)),
    db
      .select({ count: sql<number>`count(*)` })
      .from(nozzles)
      .where(eq(nozzles.active, true)),
    db.select({ count: sql<number>`count(*)` }).from(fuelTanks),
    db
      .select({ count: sql<number>`count(*)` })
      .from(rewards)
      .where(eq(rewards.active, true)),
    db.select({ count: sql<number>`count(*)` }).from(settings),
  ]);
  return {
    section: "system",
    activeProductsByCategory: productGroups.map(row => ({
      key: row.key,
      count: Number(row.count),
    })),
    activePumps: Number(pumpCount[0]?.count ?? 0),
    activeNozzles: Number(nozzleCount[0]?.count ?? 0),
    fuelTanks: Number(tankCount[0]?.count ?? 0),
    activeRewards: Number(rewardCount[0]?.count ?? 0),
    configuredSettings: Number(settingCount[0]?.count ?? 0),
  };
}

async function queryAudit(): Promise<AuditSummary> {
  const db = getDb();
  const range = bangkokRanges();
  const rows = await db
    .select({ key: auditLogs.action, count: sql<number>`count(*)` })
    .from(auditLogs)
    .where(
      and(
        gte(auditLogs.createdAt, range.todayStart),
        lt(auditLogs.createdAt, range.tomorrowStart)
      )
    )
    .groupBy(auditLogs.action);
  return {
    section: "audit",
    todayActions: rows
      .map(row => ({ key: row.key, count: Number(row.count) }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 15),
  };
}

async function querySingleSection(
  section: Exclude<AdminBusinessSection, "all">
): Promise<SingleAdminBusinessSummary> {
  switch (section) {
    case "finance":
      return queryFinance();
    case "customers":
      return queryCustomers();
    case "workforce":
      return queryWorkforce();
    case "documents":
      return queryDocuments();
    case "system":
      return querySystem();
    case "audit":
      return queryAudit();
  }
}

export async function queryAdminBusinessSummary(
  section: AdminBusinessSection
): Promise<AdminBusinessSummary> {
  if (section !== "all") return querySingleSection(section);
  const sections = ADMIN_BUSINESS_SECTIONS.filter(
    (item): item is Exclude<AdminBusinessSection, "all"> => item !== "all"
  );
  return {
    section: "all",
    summaries: await Promise.all(sections.map(querySingleSection)),
  };
}

const labels: Record<string, string> = {
  admin: "ผู้ดูแลระบบ",
  manager: "ผู้จัดการ",
  cashier: "พนักงานขาย",
  scheduled: "ตามตาราง",
  completed: "เสร็จสิ้น",
  leave: "ลา",
  absent: "ขาดงาน",
  draft: "ร่าง",
  paid: "จ่ายแล้ว",
  voided: "ยกเลิก",
  silver: "Silver",
  gold: "Gold",
  platinum: "Platinum",
  fuel: "น้ำมัน",
  lubricant: "น้ำมันเครื่อง",
  other: "สินค้าอื่น",
};

function label(key: string) {
  return labels[key] ?? key;
}

function number(value: number, digits = 2) {
  return new Intl.NumberFormat("th-TH", {
    maximumFractionDigits: digits,
  }).format(value);
}

function groupCounts(rows: GroupCount[]) {
  return rows.length
    ? rows.map(row => `${label(row.key)} ${row.count}`).join(", ")
    : "ไม่มีข้อมูล";
}

function groupTotals(rows: GroupCountTotal[]) {
  return rows.length
    ? rows
        .map(
          row =>
            `${label(row.key)} ${row.count} รายการ / ${number(row.total)} บาท`
        )
        .join(", ")
    : "ไม่มีข้อมูล";
}

function renderSingle(summary: SingleAdminBusinessSummary): string {
  switch (summary.section) {
    case "finance":
      return [
        "การเงินและค่าใช้จ่าย",
        `- วันนี้: ยอดขาย ${summary.today.sales.count} บิล / ${number(summary.today.sales.total)} บาท; ค่าใช้จ่าย ${summary.today.expenses.count} รายการ / ${number(summary.today.expenses.total)} บาท`,
        `- เดือนนี้: ยอดขาย ${summary.currentMonth.sales.count} บิล / ${number(summary.currentMonth.sales.total)} บาท; ค่าใช้จ่าย ${summary.currentMonth.expenses.count} รายการ / ${number(summary.currentMonth.expenses.total)} บาท`,
        `- หมวดค่าใช้จ่ายเดือนนี้: ${groupTotals(summary.currentMonth.expenseCategories)}`,
      ].join("\n");
    case "customers":
      return [
        "สมาชิก ลูกค้าธุรกิจ และเครดิต",
        `- สมาชิก ${summary.members.total} ราย (${groupCounts(summary.members.byTier)})`,
        `- ลูกค้าธุรกิจ ${summary.businessCustomers} ราย`,
        `- ลูกหนี้คงค้าง ${summary.credit.debtorCount} ราย รวม ${number(summary.credit.outstandingTotal)} บาท`,
        `- รับชำระเดือนนี้ ${summary.credit.paymentsCurrentMonth.count} รายการ รวม ${number(summary.credit.paymentsCurrentMonth.total)} บาท`,
      ].join("\n");
    case "workforce":
      return [
        "บุคลากรและตารางงาน",
        `- พนักงานที่ใช้งาน: ${groupCounts(summary.activeStaffByRole)}`,
        `- รูปแบบกะที่ใช้งาน ${summary.activeShiftTemplates} รูปแบบ`,
        `- ตารางงานวันนี้: ${groupCounts(summary.todaySchedules)}`,
        `- เงินเดือนเดือนนี้: ${groupTotals(summary.currentMonthPayroll)}`,
      ].join("\n");
    case "documents":
      return [
        "เอกสารและสถานะบิล",
        `- ใบกำกับภาษีวันนี้ ${summary.taxInvoicesToday.count} ฉบับ มูลค่า ${number(summary.taxInvoicesToday.total)} บาท`,
        `- ใบกำกับภาษีเดือนนี้ ${summary.taxInvoicesCurrentMonth.count} ฉบับ มูลค่า ${number(summary.taxInvoicesCurrentMonth.total)} บาท`,
        `- สถานะบิลเดือนนี้: ${groupTotals(summary.salesCurrentMonthByStatus)}`,
        `- เปลี่ยนราคาสินค้าเดือนนี้ ${summary.priceChangesCurrentMonth} ครั้ง`,
      ].join("\n");
    case "system":
      return [
        "โครงสร้างสถานีและข้อมูลหลัก",
        `- สินค้าที่ใช้งาน: ${groupCounts(summary.activeProductsByCategory)}`,
        `- ตู้จ่าย ${summary.activePumps}, หัวจ่าย ${summary.activeNozzles}, ถังน้ำมัน ${summary.fuelTanks}`,
        `- รางวัลสมาชิกที่ใช้งาน ${summary.activeRewards} รายการ`,
        `- ค่าระบบที่กำหนดแล้ว ${summary.configuredSettings} รายการ (ไม่แสดงค่า)`,
      ].join("\n");
    case "audit":
      return [
        "Audit วันนี้ (สรุปตามประเภท ไม่แสดงผู้ทำหรือรายละเอียด)",
        `- ${groupCounts(summary.todayActions)}`,
      ].join("\n");
  }
}

export function renderAdminBusinessSummary(
  summary: AdminBusinessSummary
): string {
  const body =
    summary.section === "all"
      ? summary.summaries.map(renderSingle).join("\n\n")
      : renderSingle(summary);
  return `${body}\n\nข้อมูลทั้งหมดอ่านและจัดรูปภายใน PumpPOS โดยไม่ได้ส่งผล query ให้ DeepSeek`;
}
