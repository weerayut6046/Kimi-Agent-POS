export const MEMBER_CODE_LENGTH = 16;
export const MEMBER_CODE_PREFIX = "88";

/** ตัดช่องว่าง/ขีดที่ผู้ใช้อาจพิมพ์ตามรูปแบบบนหน้าบัตร */
export function normalizeMemberCode(value: string) {
  return value
    .trim()
    .replace(/[\s-]+/g, "")
    .toUpperCase();
}

export function luhnCheckDigit(body: string) {
  if (!/^\d+$/.test(body)) throw new Error("รหัสสำหรับคำนวณต้องเป็นตัวเลข");

  let sum = 0;
  let doubleDigit = true;
  for (let index = body.length - 1; index >= 0; index -= 1) {
    let digit = Number(body[index]);
    if (doubleDigit) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    doubleDigit = !doubleDigit;
  }
  return String((10 - (sum % 10)) % 10);
}

export function isLongMemberCode(value: string) {
  const code = normalizeMemberCode(value);
  if (!new RegExp(`^\\d{${MEMBER_CODE_LENGTH}}$`).test(code)) return false;
  if (!code.startsWith(MEMBER_CODE_PREFIX)) return false;
  return luhnCheckDigit(code.slice(0, -1)) === code.at(-1);
}

/** อ่านเลขจากการกรอกตรง หรือ payload ที่เครื่องอ่าน Barcode/QR ส่งมา */
export function extractMemberCardCode(value: string) {
  const normalized = normalizeMemberCode(value);
  if (isLongMemberCode(normalized)) return normalized;

  for (const match of value.matchAll(/\d{16}/g)) {
    if (isLongMemberCode(match[0])) return match[0];
  }
  return normalized;
}

/** รองรับรหัส Mxxxx รุ่นเดิมควบคู่กับบัตรเลข 16 หลักรุ่นใหม่ */
export function isScannableMemberCode(value: string) {
  const code = normalizeMemberCode(value);
  return /^M\d{4,}$/.test(code) || isLongMemberCode(code);
}

export function formatMemberCode(value: string) {
  const code = normalizeMemberCode(value);
  if (!/^\d{16}$/.test(code)) return code;
  return code.replace(/(\d{4})(?=\d)/g, "$1 ");
}

function secureRandomDigits(length: number) {
  const digits: string[] = [];
  while (digits.length < length) {
    const bytes = new Uint8Array(Math.max(16, (length - digits.length) * 2));
    globalThis.crypto.getRandomValues(bytes);
    for (const byte of bytes) {
      // 0-249 แบ่งเป็นสิบกลุ่มเท่ากัน ป้องกัน modulo bias
      if (byte < 250) digits.push(String(byte % 10));
      if (digits.length === length) break;
    }
  }
  return digits.join("");
}

/** สร้างเลขสมาชิก 16 หลัก: prefix 88 + สุ่ม 13 หลัก + Luhn check digit */
export function generateMemberCode() {
  const body = `${MEMBER_CODE_PREFIX}${secureRandomDigits(
    MEMBER_CODE_LENGTH - MEMBER_CODE_PREFIX.length - 1
  )}`;
  return `${body}${luhnCheckDigit(body)}`;
}
