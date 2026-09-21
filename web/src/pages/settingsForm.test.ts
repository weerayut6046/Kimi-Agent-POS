import { describe, expect, it } from "vitest";
import {
  createInitialSettingsForm,
  createProductUpdatePatch,
  resolveManagedBackupHealth,
  staffMutationErrorMessage,
  staffPinValidationMessage,
  type EditableProductValues,
} from "./settingsForm";

describe("resolveManagedBackupHealth", () => {
  it("falls back safely when an older Edge Function omits backup health", () => {
    expect(resolveManagedBackupHealth(undefined)).toEqual({
      status: "unverified",
      message:
        "API รุ่นนี้ยังไม่ส่งสถานะ Backup กรุณา Deploy Supabase Edge Function รุ่นล่าสุด",
      latestBackupAt: null,
      pitrEnabled: null,
    });
  });

  it("preserves backup health returned by the current API", () => {
    const health = {
      status: "healthy" as const,
      message: "Managed Backup ล่าสุดเสร็จสมบูรณ์",
      latestBackupAt: new Date("2026-08-08T01:00:00.000Z"),
      pitrEnabled: true,
    };

    expect(resolveManagedBackupHealth(health)).toBe(health);
  });
});

describe("createInitialSettingsForm", () => {
  it("แสดงข้อมูลทันทีเมื่อ getSettings ถูก cache ไว้ก่อนเข้าหน้า Settings", () => {
    const cached = {
      shop_name: "ร้านจาก cache",
      shop_branch: "สาขาหลัก",
      vat_rate: "7",
    };

    const form = createInitialSettingsForm(cached);

    expect(form).toMatchObject(cached);
    expect(form.promotion_per_liter_feature_enabled).toBe("1");
    expect(form.bill_promotion_enabled).toBe("1");
    expect(form.promotion_discount).toBe("0.50");
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

describe("staff PIN validation", () => {
  it("rejects short PINs before sending the mutation", () => {
    expect(staffPinValidationMessage("123")).toBe("PIN ต้องมีอย่างน้อย 4 หลัก");
  });

  it("accepts only 4-6 numeric digits", () => {
    expect(staffPinValidationMessage("12a4")).toBe(
      "PIN ต้องเป็นตัวเลขเท่านั้น"
    );
    expect(staffPinValidationMessage("1234567")).toBe("PIN ต้องไม่เกิน 6 หลัก");
    expect(staffPinValidationMessage("2048")).toBeNull();
  });

  it("turns the raw Zod issue shown in Settings into a Thai message", () => {
    const rawIssue = JSON.stringify([
      {
        origin: "string",
        code: "too_small",
        minimum: 10,
        inclusive: true,
        path: ["pin"],
        message: "Invalid string: must match pattern /^\\d{4,6}$/",
      },
    ]);

    expect(staffMutationErrorMessage(new Error(rawIssue))).toBe(
      "PIN ต้องเป็นตัวเลข 4-6 หลัก"
    );
  });

  it("preserves ordinary server errors", () => {
    expect(
      staffMutationErrorMessage(new Error("ชื่อผู้ใช้นี้ถูกใช้แล้ว"))
    ).toBe("ชื่อผู้ใช้นี้ถูกใช้แล้ว");
  });
});
