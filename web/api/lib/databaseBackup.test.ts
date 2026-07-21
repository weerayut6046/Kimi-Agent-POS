import { describe, expect, it } from "vitest";
import { validateManualBackupDeletion } from "./databaseBackup";

describe("manual backup deletion guard", () => {
  it("ยอมรับเฉพาะ manual object ที่ยืนยันด้วย basename ตรงทุกตัวอักษร", () => {
    expect(
      validateManualBackupDeletion(
        "manual/2026/07/21/kimi-agent-pos-pos-20260721T010203Z.dump",
        "kimi-agent-pos-pos-20260721T010203Z.dump"
      )
    ).toBe("kimi-agent-pos-pos-20260721T010203Z.dump");
  });

  it("ปฏิเสธ scheduled, monthly, path traversal และ confirmation ที่ไม่ตรง", () => {
    expect(() =>
      validateManualBackupDeletion(
        "scheduled/2026/07/21/backup.dump",
        "backup.dump"
      )
    ).toThrow("เฉพาะไฟล์ที่สั่งสำรองเอง");
    expect(() =>
      validateManualBackupDeletion("monthly/2026-07/backup.dump", "backup.dump")
    ).toThrow("เฉพาะไฟล์ที่สั่งสำรองเอง");
    expect(() =>
      validateManualBackupDeletion(
        "manual/../scheduled/backup.dump",
        "backup.dump"
      )
    ).toThrow("ชื่อไฟล์สำรองไม่ถูกต้อง");
    expect(() =>
      validateManualBackupDeletion(
        "manual/2026/07/21/backup.dump",
        "Backup.dump"
      )
    ).toThrow("พิมพ์ชื่อไฟล์สำรองให้ตรง");
  });
});
