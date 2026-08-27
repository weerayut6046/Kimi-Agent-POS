import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReceiptDoc } from "./ReceiptDoc";

const sale = {
  receiptNo: "R000123",
  createdAt: "2026-08-27T08:00:00+07:00",
  subtotal: 407.4,
  discount: 0,
  vatRate: 7,
  vatAmount: 26.65,
  total: 407.4,
  paymentMethod: "qr",
  received: 407.4,
  changeAmt: 0,
};

const items = [
  {
    name: "แก๊สโซฮอล์ 95",
    qty: 10,
    unit: "ลิตร",
    unitPrice: 40.74,
    amount: 407.4,
  },
];

describe("ReceiptDoc payment QR", () => {
  it("แสดง QR และยอดที่ล็อกไว้ในใบเสร็จโอนจ่าย", () => {
    const html = renderToStaticMarkup(
      createElement(ReceiptDoc, {
        sale,
        items,
        settingMap: { shop_name: "สถานีทดสอบ" },
        paymentQrUrl: "data:image/png;base64,QR",
      })
    );

    expect(html).toContain("receipt-payment-qr-block");
    expect(html).toContain("data:image/png;base64,QR");
    expect(html).toContain("ยอดชำระ ฿407.40");
    expect(html).toContain("อ้างอิงบิล R000123");
  });

  it("ไม่แสดง QR ในใบเสร็จเงินสด", () => {
    const html = renderToStaticMarkup(
      createElement(ReceiptDoc, {
        sale: { ...sale, paymentMethod: "cash" },
        items,
        paymentQrUrl: "data:image/png;base64,QR",
      })
    );

    expect(html).not.toContain("receipt-payment-qr-block");
  });
});
