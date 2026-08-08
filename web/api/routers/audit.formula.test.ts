import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { and, eq } from "drizzle-orm";
import { assistantActionProposals, products, sales } from "@db/schema";
import { setupTestDb, type TestDb } from "../test/testDb";

let t: TestDb;

function fixPlanCompletion() {
  return new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call-fix-plan",
                type: "function",
                function: {
                  name: "submit_formula_audit_fix_plan",
                  arguments: JSON.stringify({
                    summary:
                      "แก้ calculation path ของยอดสุทธิและเพิ่ม regression test",
                    risk: "high",
                    impact: {
                      business: "ลดความเสี่ยงยอดขายและรายงานคลาดเคลื่อน",
                      data: "ไม่แก้ข้อมูลย้อนหลังจนกว่าจะยืนยันหลักฐาน",
                      downtime: "none",
                    },
                    steps: [
                      {
                        id: "fix-sale-total",
                        priority: "critical",
                        title: "ตรวจและแก้สูตรยอดสุทธิ",
                        reason: "พบกฎ sale_total ผิดปกติ",
                        relatedRules: ["sale_total"],
                        sourceFiles: ["web/api/routers/pos.ts"],
                        changeOutline: [
                          "รวมการคำนวณยอดสุทธิไว้ใน calculation path เดียว",
                        ],
                        verification: [
                          "เพิ่ม regression test สำหรับส่วนลดและการปัดเศษ",
                        ],
                        rollback:
                          "ย้อนเฉพาะ code patch แล้วรันทดสอบเดิมอีกครั้ง",
                      },
                    ],
                  }),
                },
              },
            ],
          },
        },
      ],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

beforeAll(async () => {
  process.env.DEEPSEEK_API_KEY = "test-auditor-deepseek-key";
  t = await setupTestDb();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(() => t.cleanup());

describe("audit.formulaAudit", () => {
  it("is restricted to administrators", async () => {
    await expect(
      t.caller("cashier").audit.formulaAudit({ days: 7 })
    ).rejects.toThrow();
    await expect(
      t.caller("manager").audit.formulaAudit({ days: 7 })
    ).rejects.toThrow();
    await expect(
      t.caller("cashier").audit.analyzeFormulaAudit({ days: 7 })
    ).rejects.toThrow();
    await expect(
      t.caller("manager").audit.createFormulaAuditFixPlan({
        days: 7,
        requestId: "8c485852-1803-48bd-b05e-868189e9ea21",
      })
    ).rejects.toThrow();
    await expect(
      t.caller("cashier").audit.approveFormulaAuditFixPlan({
        proposalId: "d5c1c9ea-3ddb-4516-a40b-2c75e9b6d591",
      })
    ).rejects.toThrow();
    await expect(
      t.caller("manager").audit.createFormulaAuditRemediationWorkOrder({
        sourceProposalId: "d5c1c9ea-3ddb-4516-a40b-2c75e9b6d591",
      })
    ).rejects.toThrow();
  });

  it("asks AI to explain fresh findings without exposing raw evidence", async () => {
    const product = await t.db.query.products.findFirst({
      where: and(eq(products.branchId, 1), eq(products.code, "WATER")),
    });
    expect(product).toBeTruthy();

    const created = await t.caller("cashier").pos.createSale({
      items: [{ productId: product!.id, qty: 1 }],
      paymentMethod: "cash",
      received: 100,
    });
    await t.db
      .update(sales)
      .set({ total: 987.65 })
      .where(and(eq(sales.branchId, 1), eq(sales.id, created.sale.id)));

    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                role: "assistant",
                content: "## สรุปความเสี่ยง\nควรตรวจสูตร sale_total ก่อน",
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await t
      .caller("admin")
      .audit.analyzeFormulaAudit({ days: 7 });

    expect(result).toMatchObject({
      provider: "deepseek",
      answer: expect.stringContaining("sale_total"),
    });
    expect(result.issuesAnalyzed).toBeGreaterThan(0);
    const requestBody = String(fetchMock.mock.calls[0]?.[1]?.body);
    expect(requestBody).toContain("sale_total");
    expect(requestBody).not.toContain(created.sale.receiptNo);
    expect(requestBody).not.toContain("987.65");
    expect(requestBody).not.toContain("test-auditor-deepseek-key");

    const stored = await t.db.query.sales.findFirst({
      where: and(eq(sales.branchId, 1), eq(sales.id, created.sale.id)),
    });
    expect(stored?.total).toBe(987.65);
  });

  it("creates and approves a structured fix plan without changing business data", async () => {
    const target = await t.db.query.sales.findFirst({
      where: and(eq(sales.branchId, 1), eq(sales.total, 987.65)),
    });
    expect(target).toBeTruthy();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(fixPlanCompletion());
    vi.stubGlobal("fetch", fetchMock);

    const caller = t.caller("admin");
    const proposal = await caller.audit.createFormulaAuditFixPlan({
      days: 7,
      requestId: "582d4a6f-1caa-4d32-8184-18c90fdf1d39",
    });

    expect(proposal).toMatchObject({
      status: "pending",
      provider: "deepseek",
      plan: {
        risk: "high",
        steps: [
          expect.objectContaining({
            relatedRules: ["sale_total"],
            sourceFiles: ["web/api/routers/pos.ts"],
          }),
        ],
      },
    });
    const externalRequest = String(fetchMock.mock.calls[0]?.[1]?.body);
    expect(externalRequest).toContain("submit_formula_audit_fix_plan");
    expect(externalRequest).not.toContain(target!.receiptNo);
    expect(externalRequest).not.toContain("987.65");
    expect(externalRequest).not.toContain("test-auditor-deepseek-key");

    const approved = await caller.audit.approveFormulaAuditFixPlan({
      proposalId: proposal.proposalId,
    });
    expect(approved).toMatchObject({
      ok: true,
      alreadyApproved: false,
      summary: expect.stringContaining("ยังไม่ได้แก้ไขข้อมูลหรือโค้ด"),
    });
    const approvedAgain = await caller.audit.approveFormulaAuditFixPlan({
      proposalId: proposal.proposalId,
    });
    expect(approvedAgain.alreadyApproved).toBe(true);

    const storedProposal = await t.db.query.assistantActionProposals.findFirst({
      where: eq(assistantActionProposals.id, proposal.proposalId),
    });
    expect(storedProposal?.status).toBe("succeeded");
    const unchanged = await t.db.query.sales.findFirst({
      where: eq(sales.id, target!.id),
    });
    expect(unchanged?.total).toBe(987.65);
  });

  it("rejects an approval when audit evidence changed after plan creation", async () => {
    const target = await t.db.query.sales.findFirst({
      where: and(eq(sales.branchId, 1), eq(sales.total, 987.65)),
    });
    expect(target).toBeTruthy();
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(fixPlanCompletion())
    );
    const caller = t.caller("admin");
    const proposal = await caller.audit.createFormulaAuditFixPlan({
      days: 7,
      requestId: "4c8297c0-269c-4d6f-900c-712fd92cc67b",
    });

    await t.db
      .update(sales)
      .set({ total: 988.65 })
      .where(and(eq(sales.branchId, 1), eq(sales.id, target!.id)));

    await expect(
      caller.audit.approveFormulaAuditFixPlan({
        proposalId: proposal.proposalId,
      })
    ).rejects.toThrow("ผล Audit เปลี่ยนแปลงแล้ว");
    const storedProposal = await t.db.query.assistantActionProposals.findFirst({
      where: eq(assistantActionProposals.id, proposal.proposalId),
    });
    expect(storedProposal?.status).toBe("cancelled");
  });

  it("creates an idempotent remediation work order and closes it only after Audit passes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(fixPlanCompletion())
    );
    const caller = t.caller("admin");
    const proposal = await caller.audit.createFormulaAuditFixPlan({
      days: 7,
      requestId: "371d31a2-fb50-4ec7-b652-20812fdfc0d1",
    });
    await caller.audit.approveFormulaAuditFixPlan({
      proposalId: proposal.proposalId,
    });

    const workOrder = await caller.audit.createFormulaAuditRemediationWorkOrder(
      {
        sourceProposalId: proposal.proposalId,
      }
    );
    const duplicate = await caller.audit.createFormulaAuditRemediationWorkOrder(
      {
        sourceProposalId: proposal.proposalId,
      }
    );
    expect(workOrder).toMatchObject({
      status: "pending",
      targetRules: [expect.objectContaining({ rule: "sale_total" })],
      sourceFiles: ["web/api/routers/pos.ts"],
    });
    const baselineCount = workOrder.targetRules[0]!.baselineCount;
    expect(baselineCount).toBeGreaterThan(0);
    expect(duplicate.workOrderId).toBe(workOrder.workOrderId);
    expect(workOrder.developerPrompt).toContain("regression tests");
    expect(workOrder.developerPrompt).not.toContain("987.65");

    const started = await caller.audit.startFormulaAuditRemediationWorkOrder({
      workOrderId: workOrder.workOrderId,
    });
    const startedAgain =
      await caller.audit.startFormulaAuditRemediationWorkOrder({
        workOrderId: workOrder.workOrderId,
      });
    expect(started.status).toBe("processing");
    expect(startedAgain.alreadyStarted).toBe(true);

    const failedVerification =
      await caller.audit.verifyFormulaAuditRemediationWorkOrder({
        workOrderId: workOrder.workOrderId,
      });
    expect(failedVerification).toMatchObject({
      status: "processing",
      passed: false,
      remaining: [
        expect.objectContaining({ rule: "sale_total", count: baselineCount }),
      ],
    });

    const current = await caller.audit.formulaAudit({ days: 7 });
    const saleTotalIssues = current.issues.filter(
      issue => issue.rule === "sale_total" && issue.expected != null
    );
    expect(saleTotalIssues).toHaveLength(baselineCount);
    for (const issue of saleTotalIssues) {
      await t.db
        .update(sales)
        .set({ total: issue.expected! })
        .where(and(eq(sales.branchId, 1), eq(sales.id, issue.refId)));
    }

    const product = await t.db.query.products.findFirst({
      where: and(eq(products.branchId, 1), eq(products.code, "WATER")),
    });
    expect(product).toBeTruthy();
    await t.db
      .update(products)
      .set({ stockQty: -1 })
      .where(and(eq(products.branchId, 1), eq(products.id, product!.id)));
    const blockedByNewIssue =
      await caller.audit.verifyFormulaAuditRemediationWorkOrder({
        workOrderId: workOrder.workOrderId,
      });
    expect(blockedByNewIssue).toMatchObject({
      status: "processing",
      passed: false,
      newOrIncreasedRules: [
        expect.objectContaining({
          rule: "product_stock",
          baselineCount: 0,
          currentCount: 1,
        }),
      ],
    });
    await t.db
      .update(products)
      .set({ stockQty: product!.stockQty })
      .where(and(eq(products.branchId, 1), eq(products.id, product!.id)));

    const passedVerification =
      await caller.audit.verifyFormulaAuditRemediationWorkOrder({
        workOrderId: workOrder.workOrderId,
      });
    expect(passedVerification).toMatchObject({
      status: "succeeded",
      passed: true,
      remaining: [expect.objectContaining({ rule: "sale_total", count: 0 })],
    });
    const storedWorkOrder = await t.db.query.assistantActionProposals.findFirst(
      {
        where: eq(assistantActionProposals.id, workOrder.workOrderId),
      }
    );
    expect(storedWorkOrder?.status).toBe("succeeded");
  });

  it("finds a corrupted sale total and returns evidence without changing data", async () => {
    const product = await t.db.query.products.findFirst({
      where: and(eq(products.branchId, 1), eq(products.code, "WATER")),
    });
    expect(product).toBeTruthy();

    const created = await t.caller("cashier").pos.createSale({
      items: [{ productId: product!.id, qty: 2 }],
      paymentMethod: "cash",
      received: 100,
    });
    const corruptTotal = created.sale.total + 1;
    await t.db
      .update(sales)
      .set({ total: corruptTotal })
      .where(and(eq(sales.branchId, 1), eq(sales.id, created.sale.id)));

    const result = await t.caller("admin").audit.formulaAudit({ days: 7 });
    const totalIssue = result.issues.find(
      row => row.rule === "sale_total" && row.refId === created.sale.id
    );

    expect(result.ruleCount).toBeGreaterThanOrEqual(20);
    expect(result.status).toBe("critical");
    expect(totalIssue).toMatchObject({
      actual: corruptTotal,
      expected: created.sale.total,
      difference: 1,
      reference: created.sale.receiptNo,
    });

    const stored = await t.db.query.sales.findFirst({
      where: and(eq(sales.branchId, 1), eq(sales.id, created.sale.id)),
    });
    expect(stored?.total).toBe(corruptTotal);
  });

  it("keeps audit findings isolated to the selected branch", async () => {
    const main = t.caller("admin");
    const createdBranch = await main.auth.createBranch({
      code: "AUDIT2",
      name: "สาขาทดสอบ Auditor",
      address: "",
      phone: "",
      taxId: "",
      cloneCurrentSetup: true,
    });
    const second = t.caller("admin", 1, createdBranch.branch.id);
    const secondProducts = await second.catalog.listProducts();
    const secondProduct = secondProducts.find(row => row.category === "fuel");
    expect(secondProduct).toBeTruthy();

    const created = await second.pos.createSale({
      items: [{ productId: secondProduct!.id, qty: 1 }],
      paymentMethod: "cash",
      received: 100,
    });
    await t.db
      .update(sales)
      .set({ total: created.sale.total + 2 })
      .where(
        and(
          eq(sales.branchId, createdBranch.branch.id),
          eq(sales.id, created.sale.id)
        )
      );

    const [mainResult, secondResult] = await Promise.all([
      main.audit.formulaAudit({ days: 7 }),
      second.audit.formulaAudit({ days: 7 }),
    ]);
    expect(
      mainResult.issues.some(
        row => row.rule === "sale_total" && row.refId === created.sale.id
      )
    ).toBe(false);
    expect(
      secondResult.issues.some(
        row => row.rule === "sale_total" && row.refId === created.sale.id
      )
    ).toBe(true);
  });
});
