export const WORK_LEAVE_TYPES = [
  "sick",
  "personal",
  "vacation",
  "other",
] as const;
export type WorkLeaveType = (typeof WORK_LEAVE_TYPES)[number];

export const WORK_LEAVE_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "cancelled",
] as const;
export type WorkLeaveStatus = (typeof WORK_LEAVE_STATUSES)[number];

export const workLeaveTypeLabel: Record<WorkLeaveType, string> = {
  sick: "ลาป่วย",
  personal: "ลากิจ",
  vacation: "ลาพักผ่อน",
  other: "ลาอื่น ๆ",
};

export const workLeaveStatusLabel: Record<WorkLeaveStatus, string> = {
  pending: "รออนุมัติ",
  approved: "อนุมัติแล้ว",
  rejected: "ปฏิเสธ",
  cancelled: "ยกเลิก",
};

export function leaveCalendarDays(startOn: string, endOn: string) {
  return (Date.parse(endOn) - Date.parse(startOn)) / 86_400_000 + 1;
}
