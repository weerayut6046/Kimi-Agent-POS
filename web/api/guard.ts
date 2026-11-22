import { publicQuery } from "./middleware";
import { staffSessionFromHeader } from "./lib/session";
import { TRPCError } from "@trpc/server";
import {
  canPerformBusinessAction,
  type BusinessAction,
} from "./lib/businessPermissions";

/** งานที่อนุญาตเฉพาะ Supabase-authenticated admin */
export const adminQuery = publicQuery.use(({ ctx, next }) => {
  const session = ctx.staff;
  if (!session) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่",
    });
  }
  if (session.role !== "admin") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "สิทธิ์ไม่เพียงพอ — การกระทำนี้สงวนไว้สำหรับผู้ดูแลระบบ (admin)",
    });
  }
  return next({ ctx });
});

/**
 * managerQuery — procedure สำหรับงานจัดการข้อมูลหลัก (เช่น ลูกค้า)
 * อนุญาตเฉพาะผู้ดูแลระบบ (admin) หรือผู้จัดการสาขา (manager)
 */
export const managerQuery = publicQuery.use(({ ctx, next }) => {
  const session = ctx.staff;
  if (!session) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่",
    });
  }
  if (session.role !== "admin" && session.role !== "manager") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "สิทธิ์ไม่เพียงพอ — การกระทำนี้สงวนไว้สำหรับผู้ดูแลระบบหรือผู้จัดการสาขา",
    });
  }
  return next({ ctx });
});

/** ดึง staff id จาก request context ที่ผ่านการตรวจ Supabase Auth แล้ว */
export function staffIdFromHeader(req: Request): number | null {
  return staffSessionFromHeader(req)?.id ?? null;
}

/**
 * Reusable action-level authorization middleware for sensitive procedures.
 * A passing action check does NOT replace branch/ownership/state checks.
 * Use this guard on a procedure before handling sensitive business data.
 */
export function businessActionQuery(
  action: BusinessAction,
  ...additionalActions: BusinessAction[]
) {
  const requiredActions = [action, ...additionalActions];
  return publicQuery.use(({ ctx, next }) => {
    if (
      requiredActions.some(
        action => !canPerformBusinessAction(ctx.staff.role, action)
      )
    ) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "สิทธิ์ไม่เพียงพอสำหรับการดำเนินการนี้",
      });
    }
    return next({ ctx });
  });
}
