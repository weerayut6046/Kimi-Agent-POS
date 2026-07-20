import { describe, expect, it } from "vitest";
import { parseTaxInvoicePaper, taxInvoicePrintCss } from "./printDoc";

describe("tax invoice paper", () => {
  it("ใช้ A4 เป็นค่าเริ่มต้นเพื่อรองรับฐานข้อมูลเวอร์ชันเดิม", () => {
    expect(parseTaxInvoicePaper(undefined)).toBe("a4");
    expect(parseTaxInvoicePaper("ค่าที่ไม่รองรับ")).toBe("a4");
  });

  it("รองรับ A5 และสร้าง CSS หน้ากระดาษ A5", () => {
    expect(parseTaxInvoicePaper("a5")).toBe("a5");
    expect(taxInvoicePrintCss("a5")).toEqual({
      pageCss: "size: A5 portrait; margin: 0",
      extraCss: "#tax-invoice-print{width:148mm!important;max-width:148mm!important}",
    });
  });
});
