import { describe, expect, it } from "vitest";
import {
  aggregateFormulaAuditIssues,
  buildFormulaAuditAnalysisPrompt,
} from "./formulaAuditAnalysis";
import type { FormulaAuditReport } from "./formulaAuditReport";

function report(): FormulaAuditReport {
  const checkedAt = new Date("2026-08-07T00:00:00.000Z");
  return {
    checkedAt,
    period: {
      days: 30,
      from: new Date("2026-07-08T00:00:00.000Z"),
      to: checkedAt,
    },
    scanned: {
      sales: 2,
      saleItems: 4,
      shifts: 0,
      shiftReadings: 0,
      payrollRecords: 0,
      products: 0,
      tanks: 0,
    },
    issues: [
      {
        id: "sale_total:1",
        rule: "sale_total",
        severity: "critical",
        category: "sales",
        title: "ยอดสุทธิไม่ตรงกับสูตร",
        detail: "บิล SECRET-RECEIPT-001 ของคุณสมชาย ยอด 999.99",
        suggestion: "ตรวจสูตรยอดสุทธิ",
        refType: "sale",
        refId: 731,
        reference: "SECRET-RECEIPT-001",
        actual: 999.99,
        expected: 100,
        difference: 899.99,
        occurredAt: checkedAt,
      },
      {
        id: "sale_total:2",
        rule: "sale_total",
        severity: "critical",
        category: "sales",
        title: "ยอดสุทธิไม่ตรงกับสูตร",
        detail: "บิล SECRET-RECEIPT-002",
        suggestion: "ตรวจสูตรยอดสุทธิ",
        refType: "sale",
        refId: 732,
        reference: "SECRET-RECEIPT-002",
        actual: 200,
        expected: 100,
        difference: 100,
        occurredAt: checkedAt,
      },
    ],
  };
}

describe("formula audit AI input", () => {
  it("groups repeated rules before asking the model", () => {
    expect(aggregateFormulaAuditIssues(report().issues)).toEqual([
      expect.objectContaining({
        rule: "sale_total",
        severity: "critical",
        occurrences: 2,
        sourceAreas: expect.arrayContaining(["web/api/routers/pos.ts"]),
      }),
    ]);
  });

  it("omits receipts, identities, entity IDs and monetary evidence", () => {
    const prompt = buildFormulaAuditAnalysisPrompt(report());

    expect(prompt).toContain("sale_total");
    expect(prompt).toContain('"occurrences":2');
    expect(prompt).not.toContain("SECRET-RECEIPT");
    expect(prompt).not.toContain("สมชาย");
    expect(prompt).not.toContain("999.99");
    expect(prompt).not.toContain("731");
  });
});
