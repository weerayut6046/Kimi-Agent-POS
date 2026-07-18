import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import { format } from "date-fns";
import { setupTestDb, type TestDb } from "../test/testDb";

// เทสสำรองอัตโนมัติตามเวลา ลง SQLite ชั่วคราว (backupsDir อยู่ใน temp dir ของ testDb ปลอดภัย)
// ทดสอบผ่าน runAutoBackupIfDue เท่านั้น — ห้าม startAutoBackupScheduler() ใน test
let t: TestDb;
let runAutoBackupIfDue: (now?: Date) => Promise<boolean>;
let backupsDir: () => string;

beforeAll(async () => {
  t = await setupTestDb();
  ({ runAutoBackupIfDue } = await import("./autobackup"));
  ({ backupsDir } = await import("./backup"));
});
afterAll(() => t.cleanup());

const setCfg = (entries: { key: string; value: string }[]) =>
  t.caller("admin").catalog.updateSettings({ entries });

const listAuto = () =>
  fs
    .readdirSync(backupsDir())
    .filter((f) => f.startsWith("pos-auto-") && f.endsWith(".db"))
    .sort();

/** สร้างไฟล์เปล่าชื่อ/เวลาเก่าปลอมเป็นไฟล์สำรองย้อนหลัง */
const touchFake = (name: string) => {
  const full = path.join(backupsDir(), name);
  fs.writeFileSync(full, "fake");
  const old = new Date("2020-01-01T00:00:00");
  fs.utimesSync(full, old, old);
};

describe("สำรองอัตโนมัติ (runAutoBackupIfDue)", () => {
  // ชื่อไฟล์จริงที่สร้างในเคส "เปิด + ถึงเวลา" — เอาไปเช็กต่อในเคส prune
  let createdToday = "";

  it("ปิดใช้งานอยู่ (ค่า default) → ไม่ทำอะไร ไม่มีไฟล์สำรอง", async () => {
    expect(await runAutoBackupIfDue()).toBe(false);
    expect(listAuto()).toHaveLength(0);
  });

  it("เปิด + ถึงเวลา → สร้างไฟล์ pos-auto-*.db จริง และวันเดียวกันรันซ้ำไม่ได้", async () => {
    await setCfg([
      { key: "backup_auto_enabled", value: "1" },
      { key: "backup_auto_time", value: "00:00" }, // 00:00 = ถึงเวลาเสมอไม่ว่าจะรันตอนไหน
    ]);

    const now = new Date();
    expect(await runAutoBackupIfDue(now)).toBe(true);

    const auto = listAuto();
    expect(auto).toHaveLength(1);
    expect(auto[0]).toMatch(/^pos-auto-\d{8}-\d{6}\.db$/);
    createdToday = auto[0];
    // ไฟล์จริงจาก better-sqlite3 backup ต้องมีเนื้อข้อมูล (ไม่ใช่ไฟล์เปล่า)
    expect(fs.statSync(path.join(backupsDir(), auto[0])).size).toBeGreaterThan(0);

    // วันเดียวกันรันซ้ำไม่ได้ (จำทั้งตัวแปรใน process และเช็กจากไฟล์ของวันนี้ที่มีอยู่)
    expect(await runAutoBackupIfDue(now)).toBe(false);
    expect(listAuto()).toHaveLength(1);
  });

  it("prune: keep=2 → เหลือเฉพาะไฟล์ auto ล่าสุด 2 ไฟล์ และไม่แตะไฟล์ pos-backup-/pos-pre-restore-/pos-upload-", async () => {
    // ไฟล์ auto ปลอมชื่อเก่า 3 ไฟล์ + ไฟล์ prefix อื่นที่ห้ามถูกลบ
    const fakes = [
      "pos-auto-20200101-000000.db",
      "pos-auto-20200102-000000.db",
      "pos-auto-20200103-000000.db",
    ];
    fakes.forEach(touchFake);
    const keepOut = [
      "pos-backup-20200101-000000.db",
      "pos-pre-restore-20200101-000000.db",
      "pos-upload-20200101-000000.db",
    ];
    keepOut.forEach(touchFake);

    await setCfg([{ key: "backup_auto_keep", value: "2" }]);

    // ส่ง now เป็น "พรุ่งนี้" เพื่อผ่านเงื่อนไขยังไม่ได้รันวันนี้ (เคสก่อนหน้ารันของวันนี้ไปแล้ว)
    const tomorrow = new Date(Date.now() + 86_400_000);
    expect(await runAutoBackupIfDue(tomorrow)).toBe(true);

    // จาก 5 ไฟล์ (จริงของวันนี้ + ปลอม 3 + จริงของพรุ่งนี้) ต้องเหลือ 2 ไฟล์ล่าสุด: ของวันนี้กับของพรุ่งนี้
    const remaining = listAuto();
    expect(remaining).toHaveLength(2);
    expect(remaining).toContain(createdToday);
    expect(remaining.some((f) => f.startsWith(`pos-auto-${format(tomorrow, "yyyyMMdd")}-`))).toBe(true);
    for (const f of fakes) {
      expect(fs.existsSync(path.join(backupsDir(), f))).toBe(false);
    }
    // ไฟล์ที่สำรองเอง / pre-restore / upload ต้องไม่ถูกลบ
    for (const f of keepOut) {
      expect(fs.existsSync(path.join(backupsDir(), f))).toBe(true);
    }
  });
});
