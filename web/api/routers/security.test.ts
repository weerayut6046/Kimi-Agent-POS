import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { loginAttempts, securityEvents, securityReports } from "@db/schema";
import { setupTestDb, type TestDb } from "../test/testDb";

// scan ผ่าน router ไม่ควรเรียก npm audit จริง — บังคับให้ runner ล้มเหลวเร็วๆ
vi.mock("node:child_process", () => ({
  execFile: (
    _cmd: string,
    _args: string[],
    _opts: unknown,
    callback: (error: Error | null, stdout: string) => void
  ) => callback(new Error("npm unavailable in tests"), ""),
}));

let t: TestDb;

beforeAll(async () => {
  t = await setupTestDb();
});

afterAll(() => t.cleanup());
afterEach(() => vi.unstubAllGlobals());

function ollamaAnswerResponse(answer: string) {
  return new Response(
    JSON.stringify({
      message: { role: "assistant", content: answer },
      done: true,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

describe("security router", () => {
  it("rejects non-admin and anonymous callers", async () => {
    await expect(t.caller("cashier").security.overview()).rejects.toMatchObject(
      { code: "FORBIDDEN" }
    );
    await expect(t.caller("manager").security.overview()).rejects.toMatchObject(
      { code: "FORBIDDEN" }
    );
    await expect(
      t.anonymousCaller().security.overview()
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      t.caller("cashier").security.scan({ windowDays: 7 })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("lists, filters and updates events as admin", async () => {
    await t.db.insert(securityEvents).values([
      {
        branchId: 1,
        category: "auth",
        severity: "critical",
        rule: "brute_force_login",
        title: "พยายาม login ผิดพลาดซ้ำๆ (router-case)",
        detail: { username: "router-case" },
        actorName: "router-case",
      },
      {
        branchId: 1,
        category: "system",
        severity: "info",
        rule: "price_change_burst",
        title: "เปลี่ยนราคาสินค้า 10 ครั้งภายใน 1 ชั่วโมง (price-bot)",
        detail: { count: 10 },
        actorName: "price-bot",
      },
    ]);

    const all = await t.caller("admin").security.events();
    expect(all.rows.length).toBeGreaterThanOrEqual(2);
    expect(all.truncated).toBe(false);
    const timestamps = all.rows.map(row => row.createdAt.getTime());
    expect(timestamps).toEqual([...timestamps].sort((a, b) => b - a));

    const criticalOnly = await t
      .caller("admin")
      .security.events({ severity: "critical" });
    expect(criticalOnly.rows.length).toBeGreaterThanOrEqual(1);
    expect(
      criticalOnly.rows.every(row => row.severity === "critical")
    ).toBe(true);

    const searched = await t
      .caller("admin")
      .security.events({ q: "brute_force" });
    expect(searched.rows.some(row => row.rule === "brute_force_login")).toBe(
      true
    );

    const limited = await t.caller("admin").security.events({ limit: 1 });
    expect(limited.rows).toHaveLength(1);
    expect(limited.truncated).toBe(true);

    const overview = await t.caller("admin").security.overview();
    expect(overview.criticalNew).toBeGreaterThanOrEqual(1);
    expect(overview.infoNew).toBeGreaterThanOrEqual(1);
    expect(overview.last24h).toBeGreaterThanOrEqual(2);
    expect(overview.lastScanAt).not.toBeNull();

    const target = all.rows.find(row => row.rule === "brute_force_login");
    expect(target).toBeDefined();
    await expect(
      t.caller("admin").security.setEventStatus({
        id: target!.id,
        status: "acknowledged",
      })
    ).resolves.toEqual({ ok: true });
    const updated = await t.db
      .select()
      .from(securityEvents)
      .where(eq(securityEvents.id, target!.id));
    expect(updated[0].status).toBe("acknowledged");

    const afterAck = await t.caller("admin").security.overview();
    expect(afterAck.acknowledged).toBeGreaterThanOrEqual(1);

    // cashier ไม่มีเมนู security แม้จะไม่ใช่ endpoint admin โดยตรง
    await expect(
      t.caller("cashier").security.setEventStatus({
        id: target!.id,
        status: "resolved",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("runs a scan through the admin mutation", async () => {
    const result = await t.caller("admin").security.scan({ windowDays: 7 });
    expect(result).toMatchObject({ created: expect.any(Number) });
    expect(typeof result.scanned).toBe("number");
    expect(typeof result.byRule).toBe("object");
  });

  it("analyzes events with AI and lists the stored report", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ollamaAnswerResponse("## สรุปภาพรวม\nระบบเสี่ยงปานกลาง"))
    );

    const result = await t
      .caller("admin")
      .security.analyze({ windowDays: 7 });
    expect(result.answer).toContain("สรุปภาพรวม");
    expect(result.reportId).toBeGreaterThan(0);

    const reports = await t.caller("admin").security.reports();
    expect(reports[0]).toMatchObject({
      id: result.reportId,
      windowDays: 7,
      answer: result.answer,
    });

    const stored = await t.db
      .select()
      .from(securityReports)
      .where(eq(securityReports.id, result.reportId));
    expect(stored).toHaveLength(1);
    expect(stored[0].eventCount).toBeGreaterThanOrEqual(1);
  });
});

describe("auth.reportLoginAttempt", () => {
  it("records attempts without a session and rate-limits silently", async () => {
    await expect(
      t.anonymousCaller().auth.reportLoginAttempt({
        username: "router-attempt",
        success: false,
      })
    ).resolves.toEqual({ ok: true });

    let stored = await t.db
      .select()
      .from(loginAttempts)
      .where(eq(loginAttempts.username, "router-attempt"));
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ branchId: 1, success: false, ip: "" });

    // เรียกเกิน limit 20 ครั้ง/นาที — ทุกครั้งต้องตอบ ok เงียบๆ ไม่โยน error
    for (let index = 0; index < 25; index += 1) {
      await expect(
        t.anonymousCaller().auth.reportLoginAttempt({
          username: "router-attempt",
          success: index % 5 === 0,
        })
      ).resolves.toEqual({ ok: true });
    }

    stored = await t.db
      .select()
      .from(loginAttempts)
      .where(eq(loginAttempts.username, "router-attempt"));
    expect(stored).toHaveLength(20);
    expect(stored.every(attempt => !attempt.success)).toBe(true);
  });

  it("accepts a success signal only from the matching authenticated staff", async () => {
    await expect(
      t.caller("admin").auth.reportLoginAttempt({
        username: "admin",
        success: true,
      })
    ).resolves.toEqual({ ok: true });

    const stored = await t.db
      .select()
      .from(loginAttempts)
      .where(eq(loginAttempts.username, "admin"));
    expect(stored.at(-1)).toMatchObject({ branchId: 1, success: true });
  });
});
