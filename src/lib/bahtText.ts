const DIGITS = ["", "หนึ่ง", "สอง", "สาม", "สี่", "ห้า", "หก", "เจ็ด", "แปด", "เก้า"];
const POSITIONS = ["", "สิบ", "ร้อย", "พัน", "หมื่น", "แสน"];

/** แปลงเลข 1-999999 เป็นคำอ่านไทย (ไม่รวมหน่วย) */
function sectionToText(n: number): string {
  const digits = String(n).split("").map(Number);
  const len = digits.length;
  let s = "";
  digits.forEach((d, i) => {
    const pos = len - i - 1; // 0=หน่วย 1=สิบ ... 5=แสน
    if (d === 0) return;
    if (pos === 1 && d === 1) s += "สิบ";
    else if (pos === 1 && d === 2) s += "ยี่สิบ";
    else if (pos === 0 && d === 1 && len > 1) s += "เอ็ด";
    else s += DIGITS[d] + POSITIONS[pos];
  });
  return s;
}

/** แปลงจำนวนเงินเป็นตัวอักษรไทย เช่น 1000 → "หนึ่งพันบาทถ้วน", 934.58 → "เก้าร้อยสามสิบสี่บาทห้าสิบแปดสตางค์" */
export function bahtText(n: number): string {
  if (!Number.isFinite(n)) return "";
  const negative = n < 0;
  // คิดเป็นสตางค์เต็มเพื่อเลี่ยงปัญหาทศนิยมลอยตัว
  const totalSatang = Math.round(Math.abs(n) * 100);
  const baht = Math.floor(totalSatang / 100);
  const satang = totalSatang % 100;

  let text = "";
  if (baht > 0) {
    const groups: number[] = [];
    let rest = baht;
    while (rest > 0) {
      groups.push(rest % 1000000);
      rest = Math.floor(rest / 1000000);
    }
    text =
      groups
        .map((g, gi) => (g === 0 ? "" : sectionToText(g) + "ล้าน".repeat(gi)))
        .reverse()
        .join("") + "บาท";
  }

  if (satang === 0) {
    text = (text || "ศูนย์บาท") + "ถ้วน";
  } else {
    text += sectionToText(satang) + "สตางค์";
  }
  return (negative ? "ลบ" : "") + text;
}
