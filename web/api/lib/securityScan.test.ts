import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { auditLogs, loginAttempts, securityEvents } from "@db/schema";
import { setupTestDb, type TestDb } from "../test/testDb";
import { configHygieneChecks, runSecurityScan } from "./securityScan";

let t: TestDb;

beforeAll(async () => {
  t = await setupTestDb();
});

afterAll(() => t.cleanup());

const noAudit = async () => null;

function minutesAgo(minutes: number) {
  return new Date(Date.now() - minutes * 60_000);
}

/** เวลาท้องถิ่นย้อนหลัง daysAgo วัน ที่ชั่วโมง/นาทีกำหนด — กัน flakiness เรื่อง timezone */
function localAt(daysAgo: number, hour: number, minute = 0) {
  const bangkokNow = new Date(Date.now() + 7 * 3_600_000);
  return new Date(
    Date.UTC(
      bangkokNow.getUTCFullYear(),
      bangkokNow.getUTCMonth(),
      bangkokNow.getUTCDate() - daysAgo,
      hour - 7,
      minute
    )
  );
}

describe("runSecurityScan", () => {
  it("detects brute force bursts and the success-after-burst signal", async () => {
    const attempts = [
      { success: false, createdAt: minutesAgo(26) },
      { success: false, createdAt: minutesAgo(25) },
      { success: false, createdAt: minutesAgo(24) },
      { success: false, createdAt: minutesAgo(23) },
      { success: false, createdAt: minutesAgo(22) },
      { success: true, createdAt: minutesAgo(15) },
    ];
    await t.db.insert(loginAttempts).values(
      attempts.map(attempt => ({
        branchId: 1,
        username: "attacker1",
        success: attempt.success,
        ip: "203.0.113.7",
        createdAt: attempt.createdAt,
      }))
    );

    const result = await runSecurityScan({
      branchId: 1,
      windowDays: 7,
      npmAuditRunner: noAudit,
    });

    expect(result.created).toBe(2);
    expect(result.scanned).toBeGreaterThan(0);
    expect(result.byRule).toEqual({
      brute_force_login: 1,
      brute_force_login_success: 1,
    });

    const burstEvents = await t.db
      .select()
      .from(securityEvents)
      .where(eq(securityEvents.rule, "brute_force_login"));
    const burst = burstEvents.find(event => event.actorName === "attacker1");
    expect(burst).toMatchObject({
      category: "auth",
      severity: "critical",
      status: "new",
    });
    expect(burst?.title).toContain("attacker1");
    expect(burst?.detail).toMatchObject({ username: "attacker1", failures: 5 });

    const successEvents = await t.db
      .select()
      .from(securityEvents)
      .where(eq(securityEvents.rule, "brute_force_login_success"));
    expect(
      successEvents.some(
        event =>
          event.actorName === "attacker1" &&
          event.title === "login สำเร็จหลังพยายามผิดพลาดหลายครั้ง"
      )
    ).toBe(true);
  });

  it("dedupes against still-open events on a repeated scan", async () => {
    const result = await runSecurityScan({
      branchId: 1,
      windowDays: 7,
      npmAuditRunner: noAudit,
    });
    expect(result.created).toBe(0);
    expect(result.byRule).toEqual({});
  });

  it("flags mass voids as warning and escalates to critical at 10", async () => {
    const voidsOf = (
      actorId: number,
      actorName: string,
      count: number,
      refStart: number
    ) =>
      Array.from({ length: count }, (_, index) => ({
        branchId: 1,
        action: "void_sale",
        actorId,
        actorName,
        detail: `void บิลทดสอบ ${refStart + index}`,
        refType: "sale",
        refId: refStart + index,
        createdAt: minutesAgo(50 - index),
      }));
    await t.db
      .insert(auditLogs)
      .values(voidsOf(3, "สมชาย (พนักงาน)", 3, 9001));
    await t.db
      .insert(auditLogs)
      .values(voidsOf(2, "สมหญิง (ผู้จัดการสาขา)", 10, 9101));

    const result = await runSecurityScan({
      branchId: 1,
      windowDays: 7,
      npmAuditRunner: noAudit,
    });
    expect(result.byRule.mass_void).toBe(2);

    const events = await t.db
      .select()
      .from(securityEvents)
      .where(eq(securityEvents.rule, "mass_void"));
    const warning = events.find(event => event.actorId === 3);
    const critical = events.find(event => event.actorId === 2);
    expect(warning).toMatchObject({
      category: "data_tampering",
      severity: "warning",
    });
    expect(warning?.detail).toMatchObject({ count: 3 });
    expect((warning?.detail.refIds as number[]).length).toBe(3);
    expect(critical).toMatchObject({
      category: "data_tampering",
      severity: "critical",
    });
    expect(critical?.detail).toMatchObject({ count: 10 });
  });

  it("groups off-hours activity per actor per night", async () => {
    const lateNight = localAt(1, 23, 30);
    const afterMidnight = new Date(lateNight.getTime() + 2 * 3_600_000);
    await t.db.insert(auditLogs).values([
      {
        branchId: 1,
        action: "update_sale",
        actorId: null,
        actorName: "night-owl",
        detail: "แก้บิลดึก",
        createdAt: lateNight,
      },
      {
        branchId: 1,
        action: "delete_sale",
        actorId: null,
        actorName: "night-owl",
        detail: "ลบบิลตีหนึ่งครึ่ง",
        createdAt: afterMidnight,
      },
      {
        branchId: 1,
        action: "update_sale",
        actorId: null,
        actorName: "night-owl",
        detail: "รายการเวลาปกติไม่ควรโดน",
        createdAt: localAt(0, 14, 0),
      },
    ]);

    const result = await runSecurityScan({
      branchId: 1,
      windowDays: 7,
      npmAuditRunner: noAudit,
    });
    expect(result.byRule.off_hours_activity).toBe(1);

    const events = await t.db
      .select()
      .from(securityEvents)
      .where(eq(securityEvents.rule, "off_hours_activity"));
    const event = events.find(item => item.actorName === "night-owl");
    expect(event).toMatchObject({
      category: "data_tampering",
      severity: "warning",
    });
    expect(event?.detail.count).toBe(2);
    expect(event?.detail.actions).toEqual({ update_sale: 1, delete_sale: 1 });
  });

  it("flags price change bursts as info", async () => {
    await t.db.insert(auditLogs).values(
      Array.from({ length: 10 }, (_, index) => ({
        branchId: 1,
        action: "update_price",
        actorId: null,
        actorName: "price-bot",
        detail: `เปลี่ยนราคา ${index}`,
        createdAt: minutesAgo(40 - index),
      }))
    );

    const result = await runSecurityScan({
      branchId: 1,
      windowDays: 7,
      npmAuditRunner: noAudit,
    });
    expect(result.byRule.price_change_burst).toBe(1);

    const events = await t.db
      .select()
      .from(securityEvents)
      .where(eq(securityEvents.rule, "price_change_burst"));
    const event = events.find(item => item.actorName === "price-bot");
    expect(event).toMatchObject({ category: "data_tampering", severity: "info" });
    expect(event?.detail).toMatchObject({ count: 10 });
  });

  it("flags permission changes but ignores plain profile edits", async () => {
    await t.db.insert(auditLogs).values([
      {
        branchId: 1,
        action: "update_staff",
        actorId: 1,
        actorName: "เจ้าของปั๊ม",
        detail: "แก้ไขพนักงาน somchai: role cashier→manager",
        refType: "staff",
        refId: 3,
        createdAt: minutesAgo(5),
      },
      {
        branchId: 1,
        action: "update_staff",
        actorId: 1,
        actorName: "เจ้าของปั๊ม",
        detail: "แก้ไขพนักงาน somchai: ชื่อ สมชายเก่า→สมชายใหม่",
        refType: "staff",
        refId: 3,
        createdAt: minutesAgo(4),
      },
    ]);

    const result = await runSecurityScan({
      branchId: 1,
      windowDays: 7,
      npmAuditRunner: noAudit,
    });
    expect(result.byRule.permission_escalation).toBe(1);

    const events = await t.db
      .select()
      .from(securityEvents)
      .where(eq(securityEvents.rule, "permission_escalation"));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      category: "permission",
      severity: "warning",
      actorId: 1,
    });
    expect(events[0].detail.summary).toContain("role cashier→manager");
  });

  it("stays quiet on config hygiene in the test environment", async () => {
    const events = await t.db
      .select()
      .from(securityEvents)
      .where(eq(securityEvents.rule, "config_hygiene"));
    expect(events).toHaveLength(0);

    // ตรวจ pure checks แยกต่างหาก — APP_SECRET สั้น/ค่าเริ่มต้น และ HMAC หลุดนอก test
    expect(
      configHygieneChecks({
        appSecret: "secret",
        legacyHmacSessionEnabled: false,
        nodeEnv: "production",
      }).map(finding => finding.check)
    ).toEqual(["app_secret"]);
    expect(
      configHygieneChecks({
        appSecret: "a-very-long-and-random-secret-value",
        legacyHmacSessionEnabled: true,
        nodeEnv: "production",
      }).map(finding => finding.check)
    ).toEqual(["legacy_hmac_session"]);
    expect(
      configHygieneChecks({
        appSecret: "a-very-long-and-random-secret-value",
        legacyHmacSessionEnabled: true,
        nodeEnv: "test",
      })
    ).toEqual([]);
  });

  it("records dependency vulnerabilities via the injectable runner", async () => {
    const vulnerable = await runSecurityScan({
      branchId: 1,
      windowDays: 7,
      npmAuditRunner: async () => ({ critical: 1, high: 2, moderate: 3 }),
    });
    expect(vulnerable.byRule).toEqual({ dependency_vuln: 1 });

    const events = await t.db
      .select()
      .from(securityEvents)
      .where(eq(securityEvents.rule, "dependency_vuln"));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      category: "vulnerability",
      severity: "critical",
    });

    // runner พัง (npm ไม่พร้อม) ต้องเงียบ ไม่โยน error และไม่สร้าง event เพิ่ม
    const failing = await runSecurityScan({
      branchId: 1,
      windowDays: 7,
      npmAuditRunner: async () => {
        throw new Error("npm not found");
      },
    });
    expect(failing.created).toBe(0);
  });

  it("deletes login attempts older than 30 days after each scan", async () => {
    await t.db.insert(loginAttempts).values({
      branchId: 1,
      username: "old-attempt",
      success: false,
      ip: "198.51.100.9",
      createdAt: new Date(Date.now() - 31 * 24 * 3_600_000),
    });

    await runSecurityScan({
      branchId: 1,
      windowDays: 7,
      npmAuditRunner: noAudit,
    });

    const remaining = await t.db
      .select()
      .from(loginAttempts)
      .where(eq(loginAttempts.username, "old-attempt"));
    expect(remaining).toHaveLength(0);
  });
});
