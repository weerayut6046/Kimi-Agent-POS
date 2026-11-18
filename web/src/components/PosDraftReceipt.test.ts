import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { calculateSaleItemValues } from "@contracts/saleItemValues";
import { PosDraftReceipt } from "./PosDraftReceipt";

const fuel = {
  id: 1,
  name: "แก๊สโซฮอล์ 95",
  category: "fuel",
  unit: "ลิตร",
} as const;
const noOp = () => undefined;

describe("PosDraftReceipt", () => {
  it("shows the exact fuel amount and discounts before a receipt is issued", () => {
    const qty = 500 / 37.5;
    const values = calculateSaleItemValues(qty, 37.5, true);
    const html = renderToStaticMarkup(
      createElement(PosDraftReceipt, {
        lines: [{ product: fuel, qty, values }],
        productById: new Map(),
        subtotal: values.amount,
        promotionDiscount: 5,
        pointsDiscount: 0,
        total: 495,
        onQuantityChange: noOp,
        onRemove: noOp,
      })
    );

    expect(html).toContain("รอชำระ");
    expect(html).toContain("13.333 ลิตร");
    expect(html).toContain("฿500.00");
    expect(html).toContain("−฿5.00");
    expect(html).toContain("฿495.00");
    expect(html).not.toContain("receipt-print");
    expect(html).not.toContain("เลขที่บิล");
  });
});
