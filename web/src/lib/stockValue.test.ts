import { describe, expect, it } from "vitest";
import { summarizeTankValues, tankSaleValue } from "./stockValue";

describe("stock value helpers", () => {
  const diesel = { name: "ดีเซล B7", code: "DB7", price: 31.94 };
  const gasohol95 = { name: "แก๊สโซฮอร์ 95", code: "GSH95", price: 34.56 };

  it("คูณลิตรคงเหลือด้วยราคาขายของถังนั้น", () => {
    expect(tankSaleValue({ currentLiters: 1000, product: diesel })).toBeCloseTo(
      31940
    );
    expect(tankSaleValue({ currentLiters: 0, product: diesel })).toBe(0);
  });

  it("ถังที่ไม่มีสินค้า (product เป็น null) มีมูลค่า 0", () => {
    expect(tankSaleValue({ currentLiters: 500, product: null })).toBe(0);
  });

  it("รวมถังหลายใบที่เป็นชนิดน้ำมันเดียวกันเข้าด้วยกัน และข้ามถังที่ไม่มีสินค้า", () => {
    const summary = summarizeTankValues([
      { productId: 7, currentLiters: 1000, product: diesel },
      { productId: 7, currentLiters: 500, product: diesel },
      { productId: 95, currentLiters: 350, product: gasohol95 },
      { productId: 91, currentLiters: 800, product: null },
    ]);

    expect(summary.byProduct).toHaveLength(2);
    expect(summary.total).toBeCloseTo(1500 * 31.94 + 350 * 34.56);

    const d = summary.byProduct.find(p => p.productId === 7);
    expect(d).toMatchObject({
      name: "ดีเซล B7",
      code: "DB7",
      liters: 1500,
    });
    expect(d?.value).toBeCloseTo(1500 * 31.94);
  });

  it("ไม่มีถังให้ผลรวมเป็น 0", () => {
    expect(summarizeTankValues([])).toEqual({ total: 0, byProduct: [] });
  });
});
