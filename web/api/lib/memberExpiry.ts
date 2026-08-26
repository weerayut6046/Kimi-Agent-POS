import { sql } from "drizzle-orm";
import { getDb } from "../queries/connection";

type Db = ReturnType<typeof getDb>;

/**
 * ตัดแต้มของบัตรที่ครบอายุแล้วในฐานข้อมูลแบบ atomic และบันทึก audit trail
 * ฟังก์ชันฐานข้อมูลเดียวกันถูกเรียกโดย pg_cron จึงไม่ตัดแต้มซ้ำ
 */
export async function expireDueMemberPoints(db: Db, branchId?: number) {
  await db.execute(
    branchId == null
      ? sql`select pos.expire_member_points()`
      : sql`select pos.expire_member_points(${branchId})`
  );
}
