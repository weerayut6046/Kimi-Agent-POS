import { describe, expect, it } from "vitest";
import {
  reorderTanksByProductOrder,
  sortProductsByTankOrder,
} from "./tankOrder";

describe("tank order helpers", () => {
  const tanks = [
    { id: 11, productId: 95, name: "95 หน้า" },
    { id: 21, productId: 7, name: "B7 หน้า" },
    { id: 22, productId: 7, name: "B7 หลัง" },
    { id: 31, productId: 91, name: "91" },
  ];

  it("จัดการ์ดสินค้าตามลำดับถังแรกของสินค้านั้น", () => {
    const products = [
      { productId: 91, name: "91" },
      { productId: 95, name: "95" },
      { productId: 7, name: "B7" },
      { productId: 20, name: "E20" },
    ];

    expect(
      sortProductsByTankOrder(products, tanks).map(product => product.productId)
    ).toEqual([95, 7, 91, 20]);
  });

  it("ย้ายถังทุกใบของสินค้าไปด้วยกันและรักษาลำดับภายในกลุ่ม", () => {
    expect(
      reorderTanksByProductOrder(tanks, [7, 95, 91]).map(tank => tank.id)
    ).toEqual([21, 22, 11, 31]);
  });

  it("คงถังที่ไม่อยู่ในชุดการ์ดไว้ท้ายรายการตามลำดับเดิม", () => {
    expect(
      reorderTanksByProductOrder(tanks, [91, 95]).map(tank => tank.id)
    ).toEqual([31, 11, 21, 22]);
  });
});
