import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, type TestDb } from "../test/testDb";

let t: TestDb;

beforeAll(async () => {
  delete process.env.GCS_BACKUP_BUCKET;
  delete process.env.GCS_BACKUP_CREDENTIALS_BASE64;
  t = await setupTestDb();
});

afterAll(() => t.cleanup());

describe("dbadmin backup policy", () => {
  it("แสดงนโยบายสำรองสองชั้นให้ admin โดยไม่เปิดข้อมูลให้ผู้ใช้ทั่วไป", async () => {
    const info = await t.caller("admin").dbadmin.dbInfo();

    expect(info.provider).toBe("supabase");
    expect(info.supabasePlan).toBe("Pro");
    expect(info.supabaseDailyRetentionDays).toBe(7);
    expect(info.offsiteConfigured).toBe(false);
    expect(info.backups).toEqual([]);

    await expect(t.caller("cashier").dbadmin.dbInfo()).rejects.toThrow(
      "สิทธิ์ไม่เพียงพอ"
    );
  });

  it("ไม่อนุญาตให้กู้คืนหรือทำลายไฟล์สำรองผ่านแอป production", async () => {
    await expect(
      t.caller("admin").dbadmin.restore({ fileName: "backup.dump" })
    ).rejects.toThrow("project ทดสอบ");
    await expect(
      t.caller("admin").dbadmin.deleteBackup({ fileName: "backup.dump" })
    ).rejects.toThrow("project ทดสอบ");
  });
});
