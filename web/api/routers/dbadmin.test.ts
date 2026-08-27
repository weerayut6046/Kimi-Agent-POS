import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { settings } from "@db/schema";
import { setupTestDb, type TestDb } from "../test/testDb";

let t: TestDb;

beforeAll(async () => {
  t = await setupTestDb();
});

afterAll(() => t.cleanup());

describe("dbadmin file backup", () => {
  it("แสดงโหมดดาวน์โหลดไฟล์เฉพาะ admin โดยไม่อ้างว่าเก็บสำเนาบนคลาวด์", async () => {
    const info = await t.caller("admin").dbadmin.dbInfo();

    expect(info).toMatchObject({
      provider: "postgresql",
      backupMode: "download-file",
      backupFormat: ".posbackup",
      backupStorage: "เครื่องของผู้ดูแล",
      databaseTablesIncluded: true,
      authUsersIncluded: false,
      storageObjectsIncluded: false,
    });
    expect(info.tableCount).toBeGreaterThan(30);

    await expect(t.caller("cashier").dbadmin.dbInfo()).rejects.toThrow(
      "สิทธิ์ไม่เพียงพอ"
    );
  });

  it("ส่งออกไฟล์ .posbackup และกู้คืนทุกตารางแบบ atomic ได้", async () => {
    await t.db
      .insert(settings)
      .values({ branchId: 1, key: "backup_test_marker", value: "ก่อนสำรอง" })
      .onConflictDoUpdate({
        target: [settings.branchId, settings.key],
        set: { value: "ก่อนสำรอง" },
      });

    const exported = await t.caller("admin").dbadmin.backup();
    expect(exported.backup.fileName).toMatch(/\.posbackup$/);
    expect(exported.backup.mimeType).toBe("application/gzip");
    expect(exported.backup.contentBase64.length).toBeGreaterThan(100);
    expect(exported.backup.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(exported.backup.totalRows).toBeGreaterThan(0);

    await t.db
      .update(settings)
      .set({ value: "หลังสำรอง" })
      .where(
        and(eq(settings.branchId, 1), eq(settings.key, "backup_test_marker"))
      );

    const restored = await t.caller("admin").dbadmin.restoreUpload({
      fileName: exported.backup.fileName,
      contentBase64: exported.backup.contentBase64,
      confirmation: "กู้คืนข้อมูล",
    });
    expect(restored.restored.totalRows).toBe(exported.backup.totalRows);
    expect(restored.restored.tableCount).toBe(exported.backup.tableCount);

    const marker = await t.db.query.settings.findFirst({
      where: and(
        eq(settings.branchId, 1),
        eq(settings.key, "backup_test_marker")
      ),
    });
    expect(marker?.value).toBe("ก่อนสำรอง");
  });

  it("ปฏิเสธผู้ใช้ทั่วไป คำยืนยันผิด และไฟล์เสียหาย", async () => {
    const exported = await t.caller("admin").dbadmin.backup();

    await expect(t.caller("cashier").dbadmin.backup()).rejects.toThrow(
      "สิทธิ์ไม่เพียงพอ"
    );
    await expect(
      t.caller("admin").dbadmin.restoreUpload({
        fileName: exported.backup.fileName,
        contentBase64: exported.backup.contentBase64,
        confirmation: "ไม่ยืนยัน" as "กู้คืนข้อมูล",
      })
    ).rejects.toThrow();
    await expect(
      t.caller("admin").dbadmin.restoreUpload({
        fileName: "broken.posbackup",
        contentBase64: "bm90LWEtZ3ppcC1maWxl",
        confirmation: "กู้คืนข้อมูล",
      })
    ).rejects.toThrow("ไฟล์");
  });
});
