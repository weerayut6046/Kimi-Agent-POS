import { and, desc, eq, inArray } from "drizzle-orm";
import { shifts, workSchedules } from "@db/schema";
import { bangkokDateKey } from "@contracts/promotion";
import type { StaffSessionClaims } from "./session";
import { getDb } from "../queries/connection";

export type SystemAccessReason =
  | "role_exempt"
  | "no_active_shift"
  | "active_shift_owner"
  | "scheduled_today"
  | "active_shift_locked";

export type SystemAccessStatus = {
  allowed: boolean;
  reason: SystemAccessReason;
  workDate: string;
  hasWorkSchedule: boolean;
  message: string | null;
  activeShift: {
    id: number;
    staffName: string;
    openedAt: string;
  } | null;
};

type AccessStaff = Pick<
  StaffSessionClaims,
  "id" | "name" | "role" | "branchId"
>;

const requestAccessPromises = new WeakMap<
  Request,
  Promise<SystemAccessStatus>
>();

function activeShiftSummary(
  shift: Pick<typeof shifts.$inferSelect, "id" | "staffName" | "openedAt">
) {
  return {
    id: shift.id,
    staffName: shift.staffName,
    openedAt: shift.openedAt.toISOString(),
  };
}

/**
 * ตรวจกติกาการเข้าใช้ระบบระหว่างมีกะ POS เปิดอยู่
 *
 * - admin/manager เข้าได้เสมอ
 * - พนักงานทั่วไปเข้าได้เมื่อไม่มีกะเปิด, เป็นเจ้าของกะที่เปิด หรือมีตารางงาน
 *   ของตนในสาขาและวันปัจจุบัน (scheduled/completed)
 */
export async function systemAccessForStaff(
  staff: AccessStaff,
  now = new Date()
): Promise<SystemAccessStatus> {
  const workDate = bangkokDateKey(now);
  if (staff.role === "admin" || staff.role === "manager") {
    return {
      allowed: true,
      reason: "role_exempt",
      workDate,
      hasWorkSchedule: false,
      message: null,
      activeShift: null,
    };
  }

  const db = getDb();
  const activeShift = await db.query.shifts.findFirst({
    columns: {
      id: true,
      staffId: true,
      staffName: true,
      openedAt: true,
    },
    where: and(eq(shifts.branchId, staff.branchId), eq(shifts.status, "open")),
    orderBy: desc(shifts.openedAt),
  });

  if (!activeShift) {
    return {
      allowed: true,
      reason: "no_active_shift",
      workDate,
      hasWorkSchedule: false,
      message: null,
      activeShift: null,
    };
  }

  const ownsActiveShift =
    activeShift.staffId === staff.id ||
    (activeShift.staffId == null &&
      activeShift.staffName.trim() === staff.name.trim());
  if (ownsActiveShift) {
    return {
      allowed: true,
      reason: "active_shift_owner",
      workDate,
      hasWorkSchedule: false,
      message: null,
      activeShift: activeShiftSummary(activeShift),
    };
  }

  const schedule = await db.query.workSchedules.findFirst({
    columns: { id: true },
    where: and(
      eq(workSchedules.branchId, staff.branchId),
      eq(workSchedules.staffId, staff.id),
      eq(workSchedules.workDate, workDate),
      inArray(workSchedules.status, ["scheduled", "completed"])
    ),
  });
  if (schedule) {
    return {
      allowed: true,
      reason: "scheduled_today",
      workDate,
      hasWorkSchedule: true,
      message: null,
      activeShift: activeShiftSummary(activeShift),
    };
  }

  return {
    allowed: false,
    reason: "active_shift_locked",
    workDate,
    hasWorkSchedule: false,
    message: `ขณะนี้กะของ ${activeShift.staffName} กำลังใช้งานอยู่ และคุณไม่มีตารางงานในวันนี้`,
    activeShift: activeShiftSummary(activeShift),
  };
}

/** Share the same lookup across concurrent procedures in one tRPC batch. */
export function systemAccessForRequest(
  request: Request,
  staff: AccessStaff
): Promise<SystemAccessStatus> {
  const existing = requestAccessPromises.get(request);
  if (existing) return existing;

  const pending = systemAccessForStaff(staff);
  requestAccessPromises.set(request, pending);
  const clear = () =>
    queueMicrotask(() => {
      if (requestAccessPromises.get(request) === pending) {
        requestAccessPromises.delete(request);
      }
    });
  void pending.then(clear, clear);
  return pending;
}
