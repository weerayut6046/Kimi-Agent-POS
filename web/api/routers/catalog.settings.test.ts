import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { DEFAULT_SETTINGS } from "@contracts/settings";
import { branches, settings } from "@db/schema";
import { setupTestDb, type TestDb } from "../test/testDb";

let t: TestDb;

beforeAll(async () => {
  t = await setupTestDb();
});

afterAll(() => t.cleanup());

describe("app template settings", () => {
  it("uses the default template for missing or legacy values", async () => {
    await t.db
      .delete(settings)
      .where(and(eq(settings.branchId, 1), eq(settings.key, "app_template")));
    expect((await t.caller().catalog.getSettings()).app_template).toBe(
      "pumppos"
    );
    await t.db
      .insert(settings)
      .values({
        branchId: 1,
        key: "app_template",
        value: "legacy-html-template",
      });
    expect((await t.caller().catalog.getSettings()).app_template).toBe(
      "pumppos"
    );
    await t.db
      .delete(settings)
      .where(and(eq(settings.branchId, 1), eq(settings.key, "app_template")));
  });

  it("lets administrators persist and replace registered templates", async () => {
    const result = await t
      .caller("admin")
      .catalog.updateTemplate({ template: "tailadmin" });
    expect(result).toEqual({ ok: true, template: "tailadmin" });
    expect((await t.caller().catalog.getSettings()).app_template).toBe(
      "tailadmin"
    );
    expect(
      await t.db.query.settings.findFirst({
        where: and(eq(settings.branchId, 1), eq(settings.key, "app_template")),
      })
    ).toMatchObject({ value: "tailadmin" });
    await t.caller("admin").catalog.updateTemplate({ template: "pumppos" });
    expect((await t.caller().catalog.getSettings()).app_template).toBe(
      "pumppos"
    );
  });

  it.each(["cashier", "manager"] as const)(
    "denies template changes by %s",
    async role => {
      await expect(
        t.caller(role).catalog.updateTemplate({ template: "tailadmin" })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  );

  it("denies template changes before login", async () => {
    await expect(
      t.anonymousCaller().catalog.updateTemplate({ template: "tailadmin" })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects unregistered templates through either update procedure", async () => {
    await expect(
      t
        .caller("admin")
        .catalog.updateTemplate({ template: "unregistered" as never })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const before = await t.caller().catalog.getSettings();
    await expect(
      t.caller("admin").catalog.updateSettings({
        entries: [
          { key: "shop_name", value: "Do not persist this batch" },
          { key: "app_template", value: "<script>alert(1)</script>" },
        ],
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const after = await t.caller().catalog.getSettings();
    expect(after.app_template).toBe(before.app_template);
    expect(after.shop_name).toBe(before.shop_name);
    const valid = await t
      .caller("admin")
      .catalog.updateSettings({
        entries: [{ key: "app_template", value: "tailadmin" }],
      });
    expect(valid.settings.app_template).toBe("tailadmin");
  });

  it("stores the template separately for each branch", async () => {
    await t.caller("admin").catalog.updateTemplate({ template: "pumppos" });
    const [branch] = await t.db
      .insert(branches)
      .values({ code: "TEMPLATE-TEST", name: "Template test branch" })
      .returning();
    const otherBranch = t.caller("admin", 1, branch.id);
    expect((await otherBranch.catalog.getSettings()).app_template).toBe(
      "pumppos"
    );
    await otherBranch.catalog.updateTemplate({ template: "tailadmin" });
    expect((await otherBranch.catalog.getSettings()).app_template).toBe(
      "tailadmin"
    );
    expect((await t.caller("admin").catalog.getSettings()).app_template).toBe(
      "pumppos"
    );
    expect(
      await t.db.query.settings.findFirst({
        where: and(
          eq(settings.branchId, branch.id),
          eq(settings.key, "app_template")
        ),
      })
    ).toMatchObject({ value: "tailadmin" });
  });
});

describe("catalog settings", () => {
  it("คืนค่าครบแม้ row บาง key หายจากฐานข้อมูลเก่า", async () => {
    await t.db.delete(settings).where(eq(settings.key, "backup_auto_time"));
    await t.db.delete(settings).where(eq(settings.key, "app_template"));

    const result = await t.caller().catalog.getSettings();

    expect(result.backup_auto_time).toBe(DEFAULT_SETTINGS.backup_auto_time);
    expect(result.app_theme).toBe("command");
    expect(result.app_template).toBe("pumppos");
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

  it("อนุญาตเฉพาะ admin เลือกธีมหน้าจอและบันทึกแยกตามสาขา", async () => {
    const result = await t.caller("admin").catalog.updateTheme({
      theme: "thai-modern",
    });

    expect(result).toEqual({ ok: true, theme: "thai-modern" });
    expect((await t.caller("admin").catalog.getSettings()).app_theme).toBe(
      "thai-modern"
    );
    await expect(
      t.caller("cashier").catalog.updateTheme({ theme: "calm" })
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
