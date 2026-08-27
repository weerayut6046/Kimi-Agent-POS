import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { DEFAULT_SETTINGS } from "@contracts/settings";
import { settings } from "@db/schema";
import { setupTestDb, type TestDb } from "../test/testDb";

let t: TestDb;

beforeAll(async () => {
  t = await setupTestDb();
});

afterAll(() => t.cleanup());

describe("catalog settings", () => {
  it("คืนค่าครบแม้ row บาง key หายจากฐานข้อมูลเก่า", async () => {
    await t.db.delete(settings).where(eq(settings.key, "backup_auto_time"));

    const result = await t.caller().catalog.getSettings();

    expect(result.backup_auto_time).toBe(DEFAULT_SETTINGS.backup_auto_time);
    expect(result.tax_invoice_paper_size).toBe("a4");
    expect(result.shop_name).toBeTruthy();
  });

  it("บันทึกแบบ transaction และคืนค่าที่อ่านกลับจาก PostgreSQL", async () => {
    const result = await t.caller("admin").catalog.updateSettings({
      entries: [
        { key: "shop_name", value: "ร้านทดสอบ Desktop" },
        { key: "backup_auto_time", value: "21:45" },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.settings.shop_name).toBe("ร้านทดสอบ Desktop");
    expect(result.settings.backup_auto_time).toBe("21:45");
    const [saved] = await t.db
      .select()
      .from(settings)
      .where(eq(settings.key, "shop_name"));
    expect(saved?.value).toBe("ร้านทดสอบ Desktop");
  });

  it("ไม่อนุญาตผู้ใช้ที่ไม่ใช่ admin บันทึก", async () => {
    await expect(
      t.caller("cashier").catalog.updateSettings({
        entries: [{ key: "shop_name", value: "ห้ามบันทึก" }],
      })
    ).rejects.toThrow("สิทธิ์ไม่เพียงพอ");
  });

  it("อนุญาต admin และ manager เปิดปิดโปรโมชั่นลดราคาต่อลิตร", async () => {
    const result = await t.caller("manager").catalog.updatePerLiterPromotion({
      enabled: true,
      name: "ลดน้ำมัน 50 สตางค์ต่อลิตร",
      discountPerLiter: 0.5,
      startDate: "2026-08-01",
      endDate: "2026-08-31",
    });

    expect(result.settings.promotion_per_liter_feature_enabled).toBe("1");
    expect(result.settings.promotion_enabled).toBe("1");
    expect(result.settings.promotion_name).toBe("ลดน้ำมัน 50 สตางค์ต่อลิตร");
    expect(result.settings.promotion_discount).toBe("0.5");
  });

  it("อนุญาต admin และ manager ตั้งโปรโมชั่นตามยอดเติมน้ำมันโดยไม่ปิดโปรโมชั่นต่อลิตร", async () => {
    const result = await t.caller("manager").catalog.updateBillPromotion({
      enabled: true,
      name: "เติมครบ 1,000 ลด 20",
      minimumFuelSpend: 1000,
      discount: 20,
      startDate: "2026-08-01",
      endDate: "2026-08-31",
    });

    expect(result.settings.bill_promotion_enabled).toBe("1");
    expect(result.settings.bill_promotion_min_fuel_spend).toBe("1000");
    expect(result.settings.bill_promotion_discount).toBe("20");
    expect(result.settings.promotion_per_liter_feature_enabled).toBe("1");
    expect(result.settings.promotion_enabled).toBe("1");
  });

  it("ปิดโปรโมชั่นต่อลิตรได้โดยไม่ปิดโปรโมชั่นตามยอดเติม", async () => {
    const result = await t.caller("admin").catalog.updatePerLiterPromotion({
      enabled: false,
      name: "ลดน้ำมัน 50 สตางค์ต่อลิตร",
      discountPerLiter: 0.5,
      startDate: "2026-08-01",
      endDate: "2026-08-31",
    });

    expect(result.settings.promotion_per_liter_feature_enabled).toBe("1");
    expect(result.settings.promotion_enabled).toBe("0");
    expect(result.settings.bill_promotion_enabled).toBe("1");
  });

  it("ไม่อนุญาต cashier ตั้งโปรโมชั่น", async () => {
    await expect(
      t.caller("cashier").catalog.updateBillPromotion({
        enabled: true,
        name: "ห้ามบันทึก",
        minimumFuelSpend: 1000,
        discount: 20,
        startDate: "2026-08-01",
        endDate: "2026-08-31",
      })
    ).rejects.toThrow("สิทธิ์ไม่เพียงพอ");

    await expect(
      t.caller("cashier").catalog.updatePerLiterPromotion({
        enabled: true,
        name: "ห้ามบันทึก",
        discountPerLiter: 0.5,
        startDate: "2026-08-01",
        endDate: "2026-08-31",
      })
    ).rejects.toThrow("สิทธิ์ไม่เพียงพอ");
  });
});
