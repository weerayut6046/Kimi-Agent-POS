import { describe, expect, it } from "vitest";
import {
  parseTaxInvoicePaper,
  receiptPrintCss,
  taxInvoicePrintCss,
} from "./printDoc";

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

describe("receipt QR print sizing", () => {
  it("พิมพ์ QR โอนจ่ายขนาดสแกนได้บนกระดาษ 58 และ 80 มม.", () => {
    expect(receiptPrintCss("58").extraCss).toContain(
      ".receipt-payment-qr{width:30mm!important;height:30mm!important"
    );
    expect(receiptPrintCss("80").extraCss).toContain(
      ".receipt-payment-qr{width:36mm!important;height:36mm!important"
    );
  });

  it("ไม่ใช้กฎจำกัดความสูงของโลโก้กับ QR ชำระเงิน", () => {
    const css = receiptPrintCss("80").extraCss;
    expect(css).toContain(".receipt-logo{max-height:11mm!important");
    expect(css).toContain(".receipt-payment-qr{");
    expect(css).toContain("max-height:none!important");
  });
});
