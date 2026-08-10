import { describe, expect, it } from "vitest";
import { presentManagedBackupHealth } from "./backupHealth";

describe("presentManagedBackupHealth", () => {
  it("รายงาน healthy เมื่อ daily backup ล่าสุดเสร็จและยังใหม่", () => {
    const result = presentManagedBackupHealth(
      {
        region: "ap-southeast-1",
        pitr_enabled: false,
        backups: [
          {
            status: "COMPLETED",
            inserted_at: "2026-08-08T00:00:00.000Z",
          },
        ],
      },
      new Date("2026-08-08T12:00:00.000Z")
    );

    expect(result.status).toBe("healthy");
    expect(result.latestBackupAt?.toISOString()).toBe(
      "2026-08-08T00:00:00.000Z"
    );
    expect(result.pitrEnabled).toBe(false);
  });

  it("เตือนเมื่อ daily backup เก่าเกิน 36 ชั่วโมง", () => {
    const result = presentManagedBackupHealth(
      {
        pitr_enabled: false,
        backups: [
          {
            status: "COMPLETED",
            inserted_at: "2026-08-06T00:00:00.000Z",
          },
        ],
      },
      new Date("2026-08-08T12:00:00.000Z")
    );

    expect(result.status).toBe("warning");
    expect(result.message).toContain("36 ชั่วโมง");
  });

  it("รายงานช่วงกู้คืนของ PITR", () => {
    const result = presentManagedBackupHealth(
      {
        pitr_enabled: true,
        physical_backup_data: {
          earliest_physical_backup_date_unix: 1_754_569_600,
          latest_physical_backup_date_unix: 1_754_656_000,
        },
        backups: [],
      },
      new Date("2025-08-08T12:00:00.000Z")
    );

    expect(result.status).toBe("healthy");
    expect(result.earliestRestoreAt).toBeInstanceOf(Date);
    expect(result.latestRestoreAt).toBeInstanceOf(Date);
  });

  it("ยังเตือนเมื่อรายการล่าสุดล้มเหลวแม้ PITR มีช่วงกู้คืน", () => {
    const result = presentManagedBackupHealth(
      {
        pitr_enabled: true,
        backups: [
          {
            status: "FAILED",
            inserted_at: "2026-08-08T00:00:00.000Z",
          },
        ],
        physical_backup_data: {
          earliest_physical_backup_date_unix: 1_754_569_600,
          latest_physical_backup_date_unix: 1_754_656_000,
        },
      },
      new Date("2026-08-08T12:00:00.000Z")
    );

    expect(result.status).toBe("warning");
    expect(result.message).toContain("FAILED");
  });
});
