import { describe, expect, it } from "vitest";
import { createInitialSettingsForm } from "./settingsForm";

describe("createInitialSettingsForm", () => {
  it("แสดงข้อมูลทันทีเมื่อ getSettings ถูก cache ไว้ก่อนเข้าหน้า Settings", () => {
    const cached = { shop_name: "ร้านจาก cache", shop_branch: "สาขาหลัก", vat_rate: "7" };

    const form = createInitialSettingsForm(cached);

    expect(form).toEqual(cached);
    expect(form).not.toBe(cached);
  });

  it("คืนฟอร์มว่างระหว่างที่ query ยังโหลดไม่เสร็จ", () => {
    expect(createInitialSettingsForm(undefined)).toEqual({});
  });
});
