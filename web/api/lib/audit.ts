import { eq } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { staffIdFromHeader } from "../guard";
import { auditLogs, staffUsers } from "@db/schema";

/**
 * อ่านตัวตนผู้ทำรายการจาก header x-staff-id (ระบบไม่มี session จริง — client แนบ id มาเอง)
 * คืน actorId (null ถ้าไม่ได้ส่ง/ไม่พบ) และ actorName ("" ถ้าไม่รู้จัก)
 */
export function actorFromReq(req: Request): { actorId: number | null; actorName: string } {
  const actorId = staffIdFromHeader(req);
  if (actorId == null) return { actorId: null, actorName: "" };
  const staff = getDb().query.staffUsers.findFirst({ where: eq(staffUsers.id, actorId) }).sync();
  return { actorId: staff ? actorId : null, actorName: staff?.name ?? "" };
}

/**
 * บันทึก audit log ด้วย connection ปกติ (อยู่นอก transaction ของ mutation หลัก)
 * ห้ามทำให้ mutation หลักพัง — ถ้า insert fail แค่ log error แล้วข้ามไป
 */
export function logAudit(entry: {
  action: string;
  actorId: number | null;
  actorName: string;
  detail: string;
  refType?: string;
  refId?: number;
}): void {
  try {
    getDb()
      .insert(auditLogs)
      .values({
        action: entry.action,
        actorId: entry.actorId,
        actorName: entry.actorName,
        detail: entry.detail,
        refType: entry.refType ?? null,
        refId: entry.refId ?? null,
      })
      .run();
  } catch (err) {
    console.error("บันทึก audit log ไม่สำเร็จ:", err);
  }
}
