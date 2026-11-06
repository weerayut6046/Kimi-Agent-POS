export const roundSaleMoney = (value: number) => Math.round(value * 100) / 100;

const roundStoredValue = (value: number) => Math.round(value * 1000) / 1000;

export type SaleItemValues = {
  qty: number;
  unitPrice: number;
  amount: number;
};

export function calculateSaleItemValues(
  qty: number,
  unitPrice: number,
  isFuel = false
): SaleItemValues {
  const storedQty = roundStoredValue(qty);
  const storedUnitPrice = roundStoredValue(unitPrice);
  // เมื่อกรอกเป็นบาท ลิตรที่หารจากยอดเงินยังมีทศนิยมเกินสามตำแหน่ง
  const billableQty = isFuel ? qty : storedQty;
  return {
    qty: storedQty,
    unitPrice: storedUnitPrice,
    amount: roundSaleMoney(billableQty * storedUnitPrice),
  };
}

/** คืนยอดที่คำนวณจากค่าที่บันทึกไว้เมื่อยอดรายการอยู่นอกช่วงที่ปัดได้ */
export function saleItemAmountMismatch(
  item: SaleItemValues,
  isFuel = false
): number | null {
  const { qty, unitPrice, amount } = item;
  const expected = roundSaleMoney(qty * unitPrice);
  if (Math.abs(amount - expected) <= 0.009 + Number.EPSILON) return null;

  if (isFuel && amount === roundSaleMoney(amount)) {
    // ลิตรก่อนปัดต้องอยู่ในช่วงครึ่งหนึ่งของทศนิยมตำแหน่งที่สาม
    const minimum = roundSaleMoney((qty - 0.0005) * unitPrice);
    const maximum = roundSaleMoney((qty + 0.0005) * unitPrice);
    if (amount >= minimum && amount <= maximum) return null;
  }
  return expected;
}
