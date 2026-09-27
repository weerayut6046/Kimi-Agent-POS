import { describe, expect, it } from "vitest";
import {
  parseSetupProduct,
  setupProductDraft,
  setupProductPatch,
  setupEquipmentDraft,
  setupEquipmentPatch,
} from "./setupForm";

const fuel = {
  id: 7,
  code: "DB7",
  name: "ดีเซล",
  category: "fuel" as const,
  unit: "ลิตร",
  price: 32,
  cost: 29,
  stockQty: 800,
  active: true,
};

describe("setup product updates", () => {
  it("does not send untouched price, tank quantity or unseen low-stock threshold", () => {
    const draft = setupProductDraft(fuel);
    draft.name = "ดีเซล B7";
    expect(setupProductPatch(draft, fuel)).toEqual({ id: 7, name: "ดีเซล B7" });
  });

  it("sends only an explicitly changed price", () => {
    const draft = setupProductDraft(fuel);
    draft.price = "33.5";
    expect(setupProductPatch(draft, fuel)).toEqual({ id: 7, price: 33.5 });
  });

  it("does not interpret an empty price as a confirmed zero price", () => {
    const draft = setupProductDraft(fuel);
    draft.price = "";
    expect(() => parseSetupProduct(draft, fuel.id)).toThrow("กรุณาระบุราคาขาย");
  });

  it("requires an explicit non-fuel stock count", () => {
    const draft = {
      ...setupProductDraft(fuel),
      category: "other" as const,
      stockQty: "",
    };
    expect(() => parseSetupProduct(draft)).toThrow("กรุณาระบุจำนวนสินค้า");
  });
});

const equipment = {
  id: 8,
  label: "หัวจ่าย 1",
  productId: 7,
  productName: "ดีเซล",
  pumpName: "ตู้ 1",
  tankName: "ถัง 1",
  meter: 1200,
  money: 38400,
  currentLiters: 3000,
  capacityLiters: 10000,
  lowAlertAt: 500,
  active: true,
  valid: true,
  issues: [],
};

describe("setup equipment updates", () => {
  it("can disable an existing missing-tank nozzle without inventing tank values", () => {
    const broken = {
      ...equipment,
      tankName: "",
      capacityLiters: 0,
      currentLiters: 0,
      lowAlertAt: 0,
      valid: false,
    };
    const draft = setupEquipmentDraft(broken);
    draft.active = false;
    expect(setupEquipmentPatch(draft, broken)).toEqual({
      nozzleId: 8,
      active: false,
    });
  });
  it("sends only changed real cumulative readings", () => {
    const draft = setupEquipmentDraft(equipment);
    draft.meter = "1300";
    draft.money = "41600";
    expect(setupEquipmentPatch(draft, equipment)).toEqual({
      nozzleId: 8,
      meter: 1300,
      money: 41600,
    });
  });
  it("keeps untouched tank levels and alerts out of PATCH", () => {
    const draft = setupEquipmentDraft(equipment);
    draft.label = "หัวจ่ายดีเซล";
    expect(setupEquipmentPatch(draft, equipment)).toEqual({
      nozzleId: 8,
      label: "หัวจ่ายดีเซล",
    });
  });
  it("requires explicit readings and validates physical capacity", () => {
    const draft = setupEquipmentDraft(equipment);
    draft.meter = "";
    expect(() => setupEquipmentPatch(draft, equipment)).toThrow("เลข L/P");
    draft.meter = "0";
    draft.currentLiters = "10001";
    expect(() => setupEquipmentPatch(draft, equipment)).toThrow("ความจุถัง");
  });
});
