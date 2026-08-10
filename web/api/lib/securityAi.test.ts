import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { desc, eq } from "drizzle-orm";
import { securityEvents, securityReports } from "@db/schema";
import { setupTestDb, type TestDb } from "../test/testDb";
import { analyzeSecurityEvents } from "./securityAi";

let t: TestDb;

beforeAll(async () => {
  t = await setupTestDb();
  await t.db.insert(securityEvents).values([
    {
      branchId: 1,
      category: "auth",
      severity: "critical",
      rule: "brute_force_login",
      title: "พยายาม login ผิดพลาดซ้ำๆ (attacker-ai)",
      detail: { username: "attacker-ai", failures: 7 },
      actorName: "attacker-ai",
    },
    {
      branchId: 1,
      category: "data_tampering",
      severity: "warning",
      rule: "mass_void",
      title: "ยกเลิก/ลบบิลขาย 3 ครั้งภายใน 1 ชั่วโมง (สมชาย)",
      detail: { count: 3 },
      actorId: 3,
      actorName: "สมชาย (พนักงาน)",
    },
    {
      branchId: 1,
      category: "auth",
      severity: "warning",
      rule: "old_event_outside_window",
      title: "เหตุการณ์เก่าที่ไม่ควรถูกส่งให้ AI",
      detail: { username: "old-attacker" },
      actorName: "old-attacker",
      createdAt: new Date(Date.now() - 8 * 24 * 3_600_000),
    },
  ]);
});

afterAll(() => t.cleanup());

function ollamaResponse(answer: string, status = 200) {
  return new Response(
    JSON.stringify(
      status === 200
        ? { message: { role: "assistant", content: answer }, done: true }
        : { error: "boom" }
    ),
    { status, headers: { "Content-Type": "application/json" } }
  );
}

describe("analyzeSecurityEvents", () => {
  it("sends serialized events to the provider and stores the report", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      ollamaResponse("## สรุปภาพรวม\nพบความเสี่ยงจากการ brute force")
    );

    const result = await analyzeSecurityEvents({
      branchId: 1,
      windowDays: 7,
      fetchImpl,
    });

    expect(result.answer).toContain("พบความเสี่ยง");
    expect(result.reportId).toBeGreaterThan(0);
    expect(fetchImpl).toHaveBeenCalledOnce();

    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toContain("/api/chat");
    const body = JSON.parse(String(init?.body));
    const userMessage = body.messages.find(
      (message: { role: string }) => message.role === "user"
    );
    expect(userMessage.content).toContain("brute_force_login");
    expect(userMessage.content).toContain("attacker-ai");
    expect(userMessage.content).not.toContain("old-attacker");
    expect(userMessage.content.length).toBeLessThanOrEqual(8_100);

    const stored = await t.db
      .select()
      .from(securityReports)
      .orderBy(desc(securityReports.id))
      .limit(1);
    expect(stored[0]).toMatchObject({
      id: result.reportId,
      branchId: 1,
      windowDays: 7,
      eventCount: 2,
      answer: result.answer,
    });
  });

  it("maps provider failures to tRPC gateway errors", async () => {
    const failingFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(ollamaResponse("", 500));

    await expect(
      analyzeSecurityEvents({ branchId: 1, windowDays: 7, fetchImpl: failingFetch })
    ).rejects.toMatchObject({ code: "BAD_GATEWAY" });
  });

  it("short-circuits with a stored report when there is nothing open", async () => {
    await t.db
      .update(securityEvents)
      .set({ status: "resolved" })
      .where(eq(securityEvents.branchId, 1));
    const shouldNotBeCalled = vi.fn<typeof fetch>();

    const result = await analyzeSecurityEvents({
      branchId: 1,
      windowDays: 7,
      fetchImpl: shouldNotBeCalled,
    });

    expect(shouldNotBeCalled).not.toHaveBeenCalled();
    expect(result.answer).toContain("ไม่พบเหตุการณ์ความปลอดภัย");
    const stored = await t.db
      .select()
      .from(securityReports)
      .where(eq(securityReports.id, result.reportId));
    expect(stored[0].eventCount).toBe(0);
  });
});
