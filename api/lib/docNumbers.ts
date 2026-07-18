import { eq, inArray, sql } from "drizzle-orm";
import { settings } from "@db/schema";
import type { getDb } from "../queries/connection";

type DbOrTx = Pick<ReturnType<typeof getDb>, "select" | "insert" | "update">;

const KEYS = {
  receipt: { prefix: "receipt_prefix", next: "receipt_next_no", defaultPrefix: "R" },
  tax_invoice: { prefix: "tax_invoice_prefix", next: "tax_invoice_next_no", defaultPrefix: "T" },
} as const;

/**
 * ออกเลขที่เอกสารจากตัวนับใน settings (running ต่อเนื่อง ไม่ขึ้นกับวัน)
 * เพิ่มตัวนับแบบ atomic ใน transaction เดียวกับการสร้างเอกสาร → ไม่ซ้ำ ไม่ข้ามเลข
 * รูปแบบ: {prefix}{เลข 5 หลัก} เช่น R00001, T00123
 */
export async function nextDocNo(db: DbOrTx, kind: keyof typeof KEYS): Promise<string> {
  const k = KEYS[kind];
  const rows = await db.select().from(settings).where(inArray(settings.key, [k.prefix, k.next]));
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const prefix = map[k.prefix] || k.defaultPrefix;

  // สร้างแถวตัวนับถ้ายังไม่มี แล้วเพิ่มค่าแบบ atomic
  await db
    .insert(settings)
    .values({ key: k.next, value: "1" })
    .onDuplicateKeyUpdate({ set: { key: k.next } });
  await db
    .update(settings)
    .set({ value: sql`CAST(${settings.value} AS UNSIGNED) + 1` })
    .where(eq(settings.key, k.next));

  const after = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, k.next));
  const n = Math.max(1, Number(after[0]?.value ?? "2") - 1);
  return `${prefix}${String(n).padStart(5, "0")}`;
}
