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
    expect(info.offsiteDeleteEnabled).toBe(false);
    expect(info.backups).toEqual([]);

    await expect(t.caller("cashier").dbadmin.dbInfo()).rejects.toThrow(
      "สิทธิ์ไม่เพียงพอ"
    );
  });

  it("ไม่อนุญาตให้กู้คืนทับ production", async () => {
    await expect(
      t.caller("admin").dbadmin.restore({ fileName: "backup.dump" })
    ).rejects.toThrow("project ทดสอบ");
  });

  it("ลบได้เฉพาะ manual backup ที่พิมพ์ชื่อไฟล์ยืนยันตรงกัน", async () => {
    await expect(
      t.caller("admin").dbadmin.deleteBackup({
        fileName: "scheduled/2026/07/21/backup.dump",
        confirmation: "backup.dump",
      })
    ).rejects.toThrow("เฉพาะไฟล์ที่สั่งสำรองเอง");

    await expect(
      t.caller("admin").dbadmin.deleteBackup({
        fileName: "manual/2026/07/21/backup.dump",
        confirmation: "wrong.dump",
      })
    ).rejects.toThrow("พิมพ์ชื่อไฟล์สำรองให้ตรง");

    await expect(
      t.caller("admin").dbadmin.deleteBackup({
        fileName: "manual/2026/07/21/backup.dump",
        confirmation: "backup.dump",
      })
    ).rejects.toThrow("GCS_BACKUP_DELETE_ENABLED=true");

    await expect(
      t.caller("cashier").dbadmin.deleteBackup({
        fileName: "manual/2026/07/21/backup.dump",
        confirmation: "backup.dump",
      })
    ).rejects.toThrow("สิทธิ์ไม่เพียงพอ");
  });
});
