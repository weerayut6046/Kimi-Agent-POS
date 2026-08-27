import { describe, expect, it } from "vitest";
import {
  activeBillThresholdPromotion,
  activeReceiptPromotion,
  appliedBillThresholdPromotionDiscount,
  appliedPromotionDiscount,
  bangkokDateKey,
  billPromotionSettingsValidationMessage,
  promotionSettingsValidationMessage,
} from "./promotion";

const settings = {
  promotion_per_liter_feature_enabled: "1",
  promotion_enabled: "1",
  promotion_name: "โปรโมชั่นประจำเดือน",
  promotion_discount: "0.50",
  promotion_start_date: "2026-08-01",
  promotion_end_date: "2026-08-31",
};

const billSettings = {
  bill_promotion_enabled: "1",
  bill_promotion_name: "เติมครบ 1,000 ลด 20",
  bill_promotion_min_fuel_spend: "1000",
  bill_promotion_discount: "20",
  bill_promotion_start_date: "2026-08-01",
  bill_promotion_end_date: "2026-08-31",
};

describe("receipt promotion", () => {
  it("ยึดวันเริ่มและสิ้นสุดตามเวลาไทย", () => {
    expect(bangkokDateKey("2026-07-31T17:00:00Z")).toBe("2026-08-01");
    expect(activeReceiptPromotion(settings, "2026-08-31T16:59:59Z")).toEqual({
      name: "โปรโมชั่นประจำเดือน",
      discountPerLiter: 0.5,
    });
    expect(activeReceiptPromotion(settings, "2026-08-31T17:00:00Z")).toBeNull();
  });

  it("ไม่ใช้โปรโมชั่นเมื่อปิดหรือข้อมูลไม่สมบูรณ์", () => {
    expect(
      activeReceiptPromotion(
        { ...settings, promotion_enabled: "0" },
        "2026-08-15"
      )
    ).toBeNull();
    expect(
      promotionSettingsValidationMessage({
        ...settings,
        promotion_start_date: "2026-09-01",
      })
    ).toBe("วันสิ้นสุดโปรโมชั่นต้องไม่ก่อนวันเริ่ม");
    expect(
      activeReceiptPromotion(
        { ...settings, promotion_per_liter_feature_enabled: "0" },
        "2026-08-15"
      )
    ).toBeNull();
  });

  it("คูณส่วนลดตามจำนวนลิตรและลดได้ไม่เกินยอดคงเหลือ", () => {
    const promotion = activeReceiptPromotion(settings, "2026-08-15");
    expect(appliedPromotionDiscount(promotion, 20, 100, 2)).toBe(10);
    expect(appliedPromotionDiscount(promotion, 20, 10, 9.75)).toBe(0.25);
    expect(appliedPromotionDiscount(promotion, 20, 10, 10)).toBe(0);
    expect(appliedPromotionDiscount(promotion, 0, 100)).toBe(0);
  });
});

describe("bill threshold promotion", () => {
  it("เปิดโปรโมชั่นในช่วงวันที่กำหนดตามเวลาไทย", () => {
    expect(activeBillThresholdPromotion(billSettings, "2026-08-15")).toEqual({
      name: "เติมครบ 1,000 ลด 20",
      minimumFuelSpend: 1000,
      discount: 20,
    });
    expect(activeBillThresholdPromotion(billSettings, "2026-09-01")).toBeNull();
  });

  it("ให้ส่วนลดเมื่อยอดน้ำมันถึงเกณฑ์เท่านั้น", () => {
    const promotion = activeBillThresholdPromotion(billSettings, "2026-08-15");
    expect(appliedBillThresholdPromotionDiscount(promotion, 999.99, 1200)).toBe(
      0
    );
    expect(appliedBillThresholdPromotionDiscount(promotion, 1000, 1200)).toBe(
      20
    );
    expect(appliedBillThresholdPromotionDiscount(promotion, 1000, 10, 5)).toBe(
      5
    );
  });

  it("ตรวจยอดขั้นต่ำ ส่วนลด และช่วงวันที่", () => {
    expect(
      billPromotionSettingsValidationMessage({
        ...billSettings,
        bill_promotion_discount: "1001",
      })
    ).toBe("ส่วนลดต้องไม่มากกว่ายอดเติมน้ำมันขั้นต่ำ");
    expect(
      billPromotionSettingsValidationMessage({
        ...billSettings,
        bill_promotion_start_date: "2026-09-01",
      })
    ).toBe("วันสิ้นสุดโปรโมชั่นต้องไม่ก่อนวันเริ่ม");
  });
});
