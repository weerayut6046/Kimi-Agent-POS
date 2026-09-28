import { describe, expect, it } from "vitest";
import { setupSystemDraft, setupSystemSaveInput } from "./setupSystemForm";

const existing = {
  receiptPaperSize: "80" as const,
  taxInvoicePaperSize: "a4" as const,
  silentPrint: false,
  vatRate: 7,
  pointEarnPerBaht: 25,
  pointRedeemValue: 1,
};
describe("setup system form", () => {
  it("submits only visible system fields and the visible branch snapshot", () => {
    const input = setupSystemSaveInput(setupSystemDraft(existing), 2);
    expect(input).toEqual({ ...existing, expectedBranchId: 2 });
    expect(Object.keys(input)).toHaveLength(7);
  });
  it("requires an explicit VAT value but permits an explicit zero", () => {
    const draft = setupSystemDraft(existing);
    draft.vatRate = "";
    expect(() => setupSystemSaveInput(draft, 2)).toThrow("กรุณาระบุอัตรา VAT");
    draft.vatRate = "0";
    expect(setupSystemSaveInput(draft, 2).vatRate).toBe(0);
  });
  it("rejects zero, empty or nonfinite loyalty values instead of guessing a policy", () => {
    const draft = setupSystemDraft(existing);
    for (const value of ["0", "", "Infinity"]) {
      draft.pointEarnPerBaht = value;
      expect(() => setupSystemSaveInput(draft, 2)).toThrow();
    }
    draft.pointEarnPerBaht = "25";
    draft.pointRedeemValue = "0";
    expect(() => setupSystemSaveInput(draft, 2)).toThrow("มูลค่าหนึ่งแต้ม");
  });
});
