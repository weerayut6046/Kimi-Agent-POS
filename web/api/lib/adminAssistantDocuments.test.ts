import { describe, expect, it } from "vitest";
import { buildAdminDocumentResponse } from "./adminAssistantDocuments";

describe("admin assistant document actions", () => {
  it("returns only allowlisted internal navigation for the complete document center", () => {
    const result = buildAdminDocumentResponse({ document: "all" });
    const paths = result.actions
      .filter(action => action.kind === "navigate")
      .map(action => action.path);

    expect(result.answer).toContain("เอกสารที่ admin ขอผ่านแชตได้");
    expect(paths).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^\/reports/),
        "/sales",
        "/tax-invoices",
        "/documents?type=credit-request",
        "/documents?type=vehicle-fleet",
        "/debts",
        "/workforce?tab=payroll",
      ])
    );
    expect(paths.every(path => path.startsWith("/"))).toBe(true);
    expect(paths.some(path => /^https?:/i.test(path))).toBe(false);
  });

  it("creates a direct daily report download with a validated date", () => {
    const result = buildAdminDocumentResponse({
      document: "daily_report",
      date: "2026-07-22",
    });
    expect(result.actions).toContainEqual({
      kind: "download_daily_report",
      label: "ดาวน์โหลด Z-Report 2026-07-22",
      date: "2026-07-22",
    });
  });

  it("creates a range download only for a valid range of at most 92 days", () => {
    const valid = buildAdminDocumentResponse({
      document: "sales_range",
      from: "2026-07-01",
      to: "2026-07-22",
    });
    expect(valid.actions).toContainEqual({
      kind: "download_sales_range",
      label: "ดาวน์โหลดรายงาน 2026-07-01–2026-07-22",
      from: "2026-07-01",
      to: "2026-07-22",
    });

    const invalid = buildAdminDocumentResponse({
      document: "sales_range",
      from: "2026-01-01",
      to: "2026-07-22",
    });
    expect(invalid.actions).toEqual([
      { kind: "navigate", label: "เปิดหน้าส่งออกรายงาน", path: "/reports" },
    ]);

    const invalidCalendarDate = buildAdminDocumentResponse({
      document: "sales_range",
      from: "2026-99-01",
      to: "2026-99-02",
    });
    expect(invalidCalendarDate.actions).toEqual([
      { kind: "navigate", label: "เปิดหน้าส่งออกรายงาน", path: "/reports" },
    ]);
  });
});
