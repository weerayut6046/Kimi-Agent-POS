import { describe, expect, it } from "vitest";
import type { BusinessSetupState } from "@contracts/onboarding";
import {
  emptySetupStaffForm,
  setupStaffCreateInput,
  setupStaffLoginStatus,
  validateSetupStaffForm,
  type SetupStaffForm,
} from "./SetupStaffStep.form";

const branch = { id: 7, name: "สาขาของเรา", code: "SHOP", active: true };
const form: SetupStaffForm = {
  ...emptySetupStaffForm(branch.id),
  name: "  มาลี  ",
  username: "  STAFF.One  ",
  pin: "012345",
  pinConfirmation: "012345",
};
const staff: BusinessSetupState["staff"][number] = {
  id: 21,
  name: "มาลี",
  username: "staff.one",
  role: "cashier",
  active: true,
  pinReady: true,
  authReady: true,
  faceReady: false,
  loginReady: false,
  isCurrentUser: false,
};

describe("setup staff account form", () => {
  it("uses the selected branch, default cashier permissions and normalized username without leaking confirmation fields", () => {
    expect(setupStaffCreateInput(form, branch)).toEqual({
      name: "มาลี",
      username: "staff.one",
      pin: "012345",
      role: "cashier",
      branchIds: [7],
      expectedBranchId: 7,
    });
    expect(
      setupStaffCreateInput({ ...form, role: "manager" }, branch).role
    ).toBe("manager");
  });

  it("rejects a stale branch form and inactive branch before an account request", () => {
    expect(() => setupStaffCreateInput(form, { ...branch, id: 8 })).toThrow(
      "สาขาเปลี่ยน"
    );
    expect(() =>
      setupStaffCreateInput(form, { ...branch, active: false })
    ).toThrow("ปิดใช้งาน");
  });

  it("rejects admin escalation even if an unexpected role reaches the form", () => {
    expect(
      validateSetupStaffForm(
        { ...form, role: "admin" as SetupStaffForm["role"] },
        branch
      )
    ).toBe("กรุณาเลือกพนักงานขายหรือผู้จัดการ");
  });

  it.each([
    ["123", "PIN ต้องมีอย่างน้อย 4 หลัก"],
    ["1234567", "PIN ต้องไม่เกิน 6 หลัก"],
    ["12a4", "PIN ต้องเป็นตัวเลขเท่านั้น"],
  ])("rejects invalid PIN %s with an actionable message", (pin, message) => {
    expect(
      validateSetupStaffForm({ ...form, pin, pinConfirmation: pin }, branch)
    ).toBe(message);
  });

  it("requires matching PIN confirmation and a valid personal username", () => {
    expect(
      validateSetupStaffForm({ ...form, pinConfirmation: "654321" }, branch)
    ).toBe("PIN ทั้งสองช่องไม่ตรงกัน");
    expect(
      validateSetupStaffForm({ ...form, username: "พนักงาน" }, branch)
    ).toContain("ชื่อผู้ใช้ต้องมี");
    expect(validateSetupStaffForm({ ...form, name: "  " }, branch)).toBe(
      "กรุณาระบุชื่อพนักงาน"
    );
    expect(emptySetupStaffForm(branch.id).pin).toBe("");
    expect(emptySetupStaffForm(branch.id).pinConfirmation).toBe("");
  });
});

describe("setup staff readiness messages", () => {
  it("does not call a newly provisioned account ready while face enrollment is pending", () => {
    expect(setupStaffLoginStatus(staff)).toEqual({
      label: "รอลงทะเบียนใบหน้า",
      ready: false,
    });
  });

  it("honors a server-approved current account or passkey without inventing a face requirement", () => {
    expect(
      setupStaffLoginStatus({ ...staff, loginReady: true, pinReady: false })
        .ready
    ).toBe(true);
    expect(
      setupStaffLoginStatus({ ...staff, loginReady: true, isCurrentUser: true })
        .label
    ).toBe("พร้อมเข้าสู่ระบบ");
  });

  it("keeps inactive accounts blocked and distinguishes missing login prerequisites", () => {
    expect(
      setupStaffLoginStatus({ ...staff, loginReady: true, active: false }).ready
    ).toBe(false);
    expect(setupStaffLoginStatus({ ...staff, pinReady: false }).label).toBe(
      "ยังไม่ได้ตั้ง PIN"
    );
    expect(setupStaffLoginStatus({ ...staff, authReady: false }).label).toBe(
      "บัญชียังไม่พร้อมเข้าสู่ระบบ"
    );
    expect(setupStaffLoginStatus({ ...staff, faceReady: true }).ready).toBe(
      false
    );
  });
});
