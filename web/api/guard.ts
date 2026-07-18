import { publicQuery } from "./middleware";

/**
 * adminQuery — procedure สำหรับงานเพิ่ม/แก้ไข/ลบข้อมูล
 * อนุญาตเฉพาะผู้ใช้ที่ส่ง role = "admin" มาทาง header (ออกแบบสำหรับระบบ PIN ภายในปั๊ม)
 */
export const adminQuery = publicQuery.use(({ ctx, next }) => {
  if (ctx.req.headers.get("x-staff-role") !== "admin") {
    throw new Error("สิทธิ์ไม่เพียงพอ — การกระทำนี้สงวนไว้สำหรับผู้ดูแลระบบ (admin)");
  }
  return next({ ctx });
});

/**
 * managerQuery — procedure สำหรับงานจัดการข้อมูลหลัก (เช่น ลูกค้า)
 * อนุญาตเฉพาะผู้ดูแลระบบ (admin) หรือผู้จัดการสาขา (manager)
 */
export const managerQuery = publicQuery.use(({ ctx, next }) => {
  const role = ctx.req.headers.get("x-staff-role");
  if (role !== "admin" && role !== "manager") {
    throw new Error("สิทธิ์ไม่เพียงพอ — การกระทำนี้สงวนไว้สำหรับผู้ดูแลระบบหรือผู้จัดการสาขา");
  }
  return next({ ctx });
});

/** ดึง staff id จาก header (ส่งโดย client) */
export function staffIdFromHeader(req: Request): number | null {
  const raw = req.headers.get("x-staff-id");
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}
