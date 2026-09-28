import { describe, expect, it } from "vitest";
import {
  readSetupProgress,
  setupFuelInput,
  setupProfileInput,
  setupPaymentsInput,
  setupEquipmentInput,
  setupSystemInput,
} from "./onboarding";

describe("saved business setup progress", () => {
  it.each([
    null,
    undefined,
    "",
    "not-json",
    '{"version":2}',
    '{"version":1,"completedAt":"yesterday"}',
  ])(
    "does not treat missing, obsolete or malformed progress %s as complete",
    stored => {
      expect(readSetupProgress(stored)).toEqual({
        version: 1,
        confirmed: {
          profile: false,
          products: false,
          staff: false,
          payments: false,
          system: false,
        },
        completedAt: null,
      });
    }
  );
  it("retains saved steps so the owner can continue on another device", () => {
    const progress = {
      version: 1,
      confirmed: {
        profile: true,
        products: false,
        staff: true,
        payments: false,
        system: false,
      },
      completedAt: null,
    };
    expect(readSetupProgress(JSON.stringify(progress))).toEqual(progress);
  });
  it("preserves completion of the previous four-step wizard without claiming a newly added explicit step", () => {
    const legacy = {
      version: 1,
      confirmed: { profile: true, products: true, staff: true, payments: true },
      completedAt: "2026-09-27T00:00:00.000Z",
    };
    expect(readSetupProgress(JSON.stringify(legacy)).confirmed.system).toBe(
      true
    );
    expect(
      readSetupProgress(
        JSON.stringify({
          ...legacy,
          confirmed: { ...legacy.confirmed, system: false },
        })
      ).confirmed.system
    ).toBe(false);
  });
});

describe("business setup input boundaries", () => {
  it("bounds printing, VAT and points while rejecting private server settings and document counters", () => {
    const input = {
      expectedBranchId: 1,
      receiptPaperSize: "58",
      taxInvoicePaperSize: "a5",
      silentPrint: false,
      vatRate: 0,
      pointEarnPerBaht: 100,
      pointRedeemValue: 1,
    };
    expect(setupSystemInput.parse(input)).toEqual(input);
    for (const extra of [
      { databaseUrl: "private" },
      { receipt_next_no: "1" },
      { vatRate: 101 },
      { pointRedeemValue: 0 },
      { receiptPaperSize: "bad" },
    ])
      expect(setupSystemInput.safeParse({ ...input, ...extra }).success).toBe(
        false
      );
  });
  it("requires a real equipment patch and rejects scope or relationship overrides", () => {
    const identity = { expectedBranchId: 1, nozzleId: 2 };
    expect(setupEquipmentInput.safeParse(identity).success).toBe(false);
    expect(
      setupEquipmentInput.safeParse({ ...identity, meter: undefined }).success
    ).toBe(false);
    expect(
      setupEquipmentInput.parse({ ...identity, meter: 0, active: false })
    ).toEqual({ ...identity, meter: 0, active: false });
    expect(
      setupEquipmentInput.safeParse({ ...identity, meter: 0, branchId: 3 })
        .success
    ).toBe(false);
    expect(
      setupEquipmentInput.safeParse({ ...identity, meter: 0, productId: 3 })
        .success
    ).toBe(false);
  });
  it("accepts only visible profile fields without branch or running-counter overrides", () => {
    const profile = {
      expectedBranchId: 1,
      shopName: " ร้านจริง ",
      branchName: "สาขาหลัก",
      address: "",
      phone: "",
      taxId: "",
    };
    expect(setupProfileInput.parse(profile).shopName).toBe("ร้านจริง");
    expect(
      setupProfileInput.safeParse({ ...profile, branchId: 2 }).success
    ).toBe(false);
    expect(
      setupProfileInput.safeParse({ ...profile, receipt_next_no: "1" }).success
    ).toBe(false);
  });
  it("requires at least one payment method and rejects advanced secret resets", () => {
    const payments = {
      expectedBranchId: 1,
      cashEnabled: true,
      qrEnabled: false,
      cardEnabled: false,
      creditEnabled: false,
    };
    expect(setupPaymentsInput.parse(payments)).not.toHaveProperty(
      "promptpayId"
    );
    expect(
      setupPaymentsInput.safeParse({ ...payments, cashEnabled: false }).success
    ).toBe(false);
    expect(
      setupPaymentsInput.safeParse({ ...payments, clearApiSecret: true })
        .success
    ).toBe(false);
  });
  it("accepts real zero opening meters and rejects tank overflow or nonfinite numbers", () => {
    const fuel = {
      expectedBranchId: 1,
      requestId: "00000000-0000-4000-8000-000000000001",
      productId: 1,
      pumpName: "ตู้ 1",
      tankName: "ถัง 1",
      nozzleLabel: "หัวจ่าย 1",
      capacityLiters: 1000,
      currentLiters: 0,
      lowAlertAt: 100,
      meter: 0,
      money: 0,
    };
    expect(setupFuelInput.parse(fuel)).toEqual(fuel);
    expect(
      setupFuelInput.safeParse({ ...fuel, currentLiters: 1001 }).success
    ).toBe(false);
    expect(
      setupFuelInput.safeParse({ ...fuel, meter: Number.POSITIVE_INFINITY })
        .success
    ).toBe(false);
  });
});
