import { getDb } from "../queries/connection";
import { staffSessionFromHeader } from "./session";
import { auditLogs } from "@db/schema";
import { publishRealtimeInvalidation } from "./realtime";

/**
 * อ่านตัวตนผู้ทำรายการจาก session ที่ตรวจลายเซ็นแล้ว
 */
export function actorFromReq(req: Request): {
  actorId: number | null;
  actorName: string;
  branchId: number;
} {
  const session = staffSessionFromHeader(req);
  return {
    actorId: session?.id ?? null,
    actorName: session?.name ?? "",
    branchId: session?.branchId ?? 1,
  };
}

/**
 * บันทึก audit log ด้วย connection ปกติ (อยู่นอก transaction ของ mutation หลัก)
 * ห้ามทำให้ mutation หลักพัง — ถ้า insert fail แค่ log error แล้วข้ามไป
 */
export function logAudit(entry: {
  action: string;
  actorId: number | null;
  actorName: string;
  branchId?: number;
  detail: string;
  refType?: string;
  refId?: number;
}): void {
  void (async () => {
    try {
      await getDb().insert(auditLogs).values({
        branchId: entry.branchId ?? 1,
        action: entry.action,
        actorId: entry.actorId,
        actorName: entry.actorName,
        detail: entry.detail,
        refType: entry.refType ?? null,
        refId: entry.refId ?? null,
      });
      publishRealtimeInvalidation(entry.branchId ?? 1);
    } catch (err) {
      console.error("บันทึก audit log ไม่สำเร็จ:", err);
    }
  })();
}
