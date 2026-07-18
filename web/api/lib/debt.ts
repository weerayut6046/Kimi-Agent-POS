import { and, eq, sql } from "drizzle-orm";
import { sales, debtPayments } from "@db/schema";
import type { getDb } from "../queries/connection";

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * ยอดค้างชำระของลูกค้าเครดิต
 * = Σ บิลขายเชื่อ (paymentMethod='credit', status='completed') − Σ การรับชำระหนี้
 * void บิลเครดิต → หนี้ลดอัตโนมัติ เพราะนับเฉพาะบิล completed
 */
export async function outstandingOf(db: ReturnType<typeof getDb>, customerId: number): Promise<number> {
  const creditRows = await db
    .select({ sum: sql<number>`coalesce(sum(${sales.total}),0)` })
    .from(sales)
    .where(
      and(
        eq(sales.customerId, customerId),
        eq(sales.paymentMethod, "credit"),
        eq(sales.status, "completed"),
      ),
    );
  const paidRows = await db
    .select({ sum: sql<number>`coalesce(sum(${debtPayments.amount}),0)` })
    .from(debtPayments)
    .where(eq(debtPayments.customerId, customerId));
  return r2((creditRows[0]?.sum ?? 0) - (paidRows[0]?.sum ?? 0));
}
