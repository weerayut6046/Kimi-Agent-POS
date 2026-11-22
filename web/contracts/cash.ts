// ค่าคงที่และฟังก์ชันสำหรับการนับเงินสดตอนปิดกะ — ใช้ร่วมกันทั้ง API และ frontend

/** มูลค่าแบงก์/เหรียญที่รองรับ (บาท) เรียงจากมากไปน้อย */
export const CASH_DENOMINATIONS = [
  1000, 500, 100, 50, 20, 10, 5, 2, 1, 0.5, 0.25,
] as const;

/** key = มูลค่าแบงก์/เหรียญในรูป string (เช่น "1000", "0.5"), value = จำนวนที่นับได้ */
export type CashCounts = Record<string, number>;

const DENOM_SET = new Set<string>(CASH_DENOMINATIONS.map(d => String(d)));

/** ตรวจว่าทุก key เป็นมูลค่าแบงก์/เหรียญที่รองรับ */
export function isValidCashCounts(counts: CashCounts): boolean {
  return Object.keys(counts).every(k => DENOM_SET.has(k));
}

/** รวมยอดเงินจากการนับแบงก์/เหรียญ (ปัด 2 ตำแหน่ง) */
export function sumCashCounts(counts: CashCounts): number {
  const total = Object.entries(counts).reduce(
    (s, [denom, n]) => s + Number(denom) * n,
    0
  );
  return Math.round(total * 100) / 100;
}

/**
 * ยอดนับได้รวมของกะ
 * = เงินสดที่นับ + ยอดโอน + ยอดขายหน้า POS ทั้งหมด − ค่าใช้จ่าย
 *
 * คืน null เมื่อกะนั้นยังไม่มีการนับเงินจริง เพื่อแยกจากยอด 0 บาท
 */
export function shiftCountedTotal(input: {
  countedCash: number | null;
  transferAmount?: number | null;
  posAmount: number;
  expensesTotal: number;
}): number | null {
  if (input.countedCash == null) return null;
  const total =
    input.countedCash +
    (input.transferAmount ?? 0) +
    input.posAmount -
    input.expensesTotal;
  return Math.round(total * 100) / 100;
}

/** ส่วนต่างของกะ = ยอดนับได้รวม − เงินสดที่ควรมี */
export function shiftCashDifference(input: {
  countedTotal: number | null;
  expectedCash: number | null;
}): number | null {
  if (input.countedTotal == null || input.expectedCash == null) return null;
  return Math.round((input.countedTotal - input.expectedCash) * 100) / 100;
}
