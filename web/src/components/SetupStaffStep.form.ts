import { isValidStaffUsername, normalizeStaffUsername } from "@contracts/auth";
import type { BusinessSetupState } from "@contracts/onboarding";
import { staffPinValidationMessage } from "@/pages/settingsForm";

export type SetupStaffForm = {
  branchId: number;
  name: string;
  username: string;
  pin: string;
  pinConfirmation: string;
  role: "cashier" | "manager";
};

export function emptySetupStaffForm(branchId: number): SetupStaffForm {
  return {
    branchId,
    name: "",
    username: "",
    pin: "",
    pinConfirmation: "",
    role: "cashier",
  };
}

export function validateSetupStaffForm(
  form: SetupStaffForm,
  branch: BusinessSetupState["branch"]
): string | null {
  if (form.branchId !== branch.id || !branch.active) {
    return "สาขาเปลี่ยนหรือปิดใช้งานแล้ว กรุณาปิดแบบฟอร์มและเลือกสาขาอีกครั้ง";
  }
  if (!form.name.trim()) return "กรุณาระบุชื่อพนักงาน";
  if (!isValidStaffUsername(form.username)) {
    return "ชื่อผู้ใช้ต้องมี 3–64 ตัว ใช้อักษรอังกฤษ ตัวเลข จุด ขีดกลาง หรือขีดล่าง และขึ้นต้นด้วยอักษรหรือตัวเลข";
  }
  if (form.role !== "cashier" && form.role !== "manager") {
    return "กรุณาเลือกพนักงานขายหรือผู้จัดการ";
  }
  const pinError = staffPinValidationMessage(form.pin);
  if (pinError) return pinError;
  if (form.pin !== form.pinConfirmation) return "PIN ทั้งสองช่องไม่ตรงกัน";
  return null;
}

export function setupStaffCreateInput(
  form: SetupStaffForm,
  branch: BusinessSetupState["branch"]
) {
  const error = validateSetupStaffForm(form, branch);
  if (error) throw new Error(error);
  return {
    name: form.name.trim(),
    username: normalizeStaffUsername(form.username),
    pin: form.pin,
    role: form.role,
    branchIds: [branch.id],
    expectedBranchId: branch.id,
  };
}

export function setupStaffLoginStatus(
  staff: BusinessSetupState["staff"][number]
) {
  if (!staff.active) return { label: "ปิดใช้งาน", ready: false };
  // The server also checks existing passkeys and the current owner's session.
  // A missing face or PIN alone cannot override its readiness decision.
  if (staff.loginReady) return { label: "พร้อมเข้าสู่ระบบ", ready: true };
  if (!staff.pinReady) return { label: "ยังไม่ได้ตั้ง PIN", ready: false };
  if (!staff.authReady)
    return { label: "บัญชียังไม่พร้อมเข้าสู่ระบบ", ready: false };
  if (!staff.faceReady) return { label: "รอลงทะเบียนใบหน้า", ready: false };
  return { label: "รอตรวจสอบการเข้าสู่ระบบ", ready: false };
}
