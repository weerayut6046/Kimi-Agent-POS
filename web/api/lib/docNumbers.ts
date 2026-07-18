import { eq, inArray, sql } from "drizzle-orm";
import { settings } from "@db/schema";
import type { getDb } from "../queries/connection";

// transaction ของ better-sqlite3 เป็น synchronous — ทุกคำสั่งในนี้ต้อง execute ด้วย .run()/.all()
type DbTx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

const KEYS = {
  receipt: { prefix: "receipt_prefix", next: "receipt_next_no", defaultPrefix: "R" },
  tax_invoice: { prefix: "tax_invoice_prefix", next: "tax_invoice_next_no", defaultPrefix: "T" },
  debt_payment: { prefix: "debt_payment_prefix", next: "debt_payment_next_no", defaultPrefix: "P" },
} as const;

/**
 * ออกเลขที่เอกสารจากตัวนับใน settings (running ต่อเนื่อง ไม่ขึ้นกับวัน)
 * เพิ่มตัวนับแบบ atomic ใน transaction เดียวกับการสร้างเอกสาร → ไม่ซ้ำ ไม่ข้ามเลข
 * รูปแบบ: {prefix}{เลข 5 หลัก} เช่น R00001, T00123
 */
export function nextDocNo(tx: DbTx, kind: keyof typeof KEYS): string {
  const k = KEYS[kind];
  const rows = tx.select().from(settings).where(inArray(settings.key, [k.prefix, k.next])).all();
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const prefix = map[k.prefix] || k.defaultPrefix;

  // สร้างแถวตัวนับถ้ายังไม่มี แล้วเพิ่มค่าแบบ atomic
  tx.insert(settings)
    .values({ key: k.next, value: "1" })
    .onConflictDoUpdate({ target: settings.key, set: { key: k.next } })
    .run();
  tx.update(settings)
    .set({ value: sql`CAST(${settings.value} AS INTEGER) + 1` })
    .where(eq(settings.key, k.next))
    .run();

  const after = tx.select({ value: settings.value }).from(settings).where(eq(settings.key, k.next)).all();
  const n = Math.max(1, Number(after[0]?.value ?? "2") - 1);
  return `${prefix}${String(n).padStart(5, "0")}`;
}
