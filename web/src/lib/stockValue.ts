type TankValueItem = {
  productId: number;
  currentLiters: number;
  product?: { name: string; code: string; price: number } | null;
};

/** มูลค่าน้ำมันคงเหลือของถัง = ลิตรคงเหลือ × ราคาขายปัจจุบัน */
export function tankSaleValue(
  tank: Pick<TankValueItem, "currentLiters" | "product">
) {
  return tank.currentLiters * (tank.product?.price ?? 0);
}

export type ProductStockValue = {
  productId: number;
  name: string;
  code: string;
  liters: number;
  value: number;
};

/** สรุปมูลค่าน้ำมันคงเหลือรวมทุกถัง แยกตามชนิดน้ำมัน (ถังชนิดเดียวกันรวมกัน) */
export function summarizeTankValues<T extends TankValueItem>(tanks: T[]) {
  const byProductId = new Map<number, ProductStockValue>();
  for (const tank of tanks) {
    if (!tank.product) continue;
    const entry = byProductId.get(tank.productId) ?? {
      productId: tank.productId,
      name: tank.product.name,
      code: tank.product.code,
      liters: 0,
      value: 0,
    };
    entry.liters += tank.currentLiters;
    entry.value += tankSaleValue(tank);
    byProductId.set(tank.productId, entry);
  }
  const byProduct = [...byProductId.values()];
  return {
    total: byProduct.reduce((sum, p) => sum + p.value, 0),
    byProduct,
  };
}
