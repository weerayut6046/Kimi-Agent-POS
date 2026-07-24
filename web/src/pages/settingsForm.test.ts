import { describe, expect, it } from "vitest";
import {
  createInitialSettingsForm,
  createProductUpdatePatch,
  staffMutationErrorMessage,
  staffPasswordValidationMessage,
  type EditableProductValues,
} from "./settingsForm";

describe("createInitialSettingsForm", () => {
  it("แสดงข้อมูลทันทีเมื่อ getSettings ถูก cache ไว้ก่อนเข้าหน้า Settings", () => {
    const cached = {
      shop_name: "ร้านจาก cache",
      shop_branch: "สาขาหลัก",
      vat_rate: "7",
    };

    const form = createInitialSettingsForm(cached);

    expect(form).toEqual(cached);
    expect(form).not.toBe(cached);
  });

  it("คืนฟอร์มว่างระหว่างที่ query ยังโหลดไม่เสร็จ", () => {
    expect(createInitialSettingsForm(undefined)).toEqual({});
  });
});

describe("createProductUpdatePatch", () => {
  const product: EditableProductValues = {
    id: 95,
    code: "GSH95",
    name: "แก๊สโซฮอล์ 95",
    category: "fuel",
    unit: "ลิตร",
    price: 38.69,
    cost: 32.8,
    stockQty: 0,
    lowStockAt: 0,
    active: true,
  };

  it("ไม่ส่งราคาหรือฟิลด์อื่นที่ผู้ใช้ไม่ได้แก้", () => {
    expect(
      createProductUpdatePatch(
        { ...product, name: "แก๊สโซฮอล์ E10 95" },
        product
      )
    ).toEqual({
      id: 95,
      name: "แก๊สโซฮอล์ E10 95",
    });
  });

  it("ส่งราคาเมื่อผู้ใช้เปลี่ยนราคาจริง", () => {
    expect(
      createProductUpdatePatch({ ...product, price: 39.19 }, product)
    ).toEqual({
      id: 95,
      price: 39.19,
    });
  });

  it("คืนเฉพาะ id เมื่อไม่มีการเปลี่ยนแปลง", () => {
    expect(createProductUpdatePatch({ ...product }, product)).toEqual({
      id: 95,
    });
  });
});

describe("staff password validation", () => {
  it("rejects short passwords before sending the mutation", () => {
    expect(staffPasswordValidationMessage("Short1")).toBe(
      "รหัสผ่านต้องมีอย่างน้อย 10 ตัวอักษร"
    );
  });

  it("requires lowercase, uppercase, and a number", () => {
    expect(staffPasswordValidationMessage("alllowercase1")).toBe(
      "รหัสผ่านต้องมีตัวพิมพ์เล็ก ตัวพิมพ์ใหญ่ และตัวเลข"
    );
    expect(staffPasswordValidationMessage("ValidPass1")).toBeNull();
  });

  it("turns the raw Zod issue shown in Settings into a Thai message", () => {
    const rawIssue = JSON.stringify([
      {
        origin: "string",
        code: "too_small",
        minimum: 10,
        inclusive: true,
        path: ["password"],
        message: "Too small: expected string to have >=10 characters",
      },
    ]);

    expect(staffMutationErrorMessage(new Error(rawIssue))).toBe(
      "รหัสผ่านต้องมีอย่างน้อย 10 ตัวอักษร"
    );
  });

  it("preserves ordinary server errors", () => {
    expect(staffMutationErrorMessage(new Error("ชื่อผู้ใช้นี้ถูกใช้แล้ว"))).toBe(
      "ชื่อผู้ใช้นี้ถูกใช้แล้ว"
    );
  });
});
