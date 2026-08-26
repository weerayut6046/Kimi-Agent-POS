import { describe, expect, it } from "vitest";
import {
  extractMemberCardCode,
  formatMemberCode,
  generateMemberCode,
  isLongMemberCode,
  isScannableMemberCode,
  luhnCheckDigit,
  normalizeMemberCode,
} from "./memberCode";

describe("member code", () => {
  it("คำนวณ Luhn check digit ตามค่ามาตรฐาน", () => {
    expect(luhnCheckDigit("7992739871")).toBe("3");
  });

  it("สร้างเลขสมาชิก 16 หลักที่มี check digit ถูกต้องและไม่ซ้ำในชุดทดสอบ", () => {
    const codes = Array.from({ length: 100 }, () => generateMemberCode());
    expect(new Set(codes)).toHaveLength(100);
    for (const code of codes) {
      expect(code).toMatch(/^88\d{14}$/);
      expect(isLongMemberCode(code)).toBe(true);
    }
  });

  it("จัดรูปแบบเพื่อแสดงผล แต่ normalize กลับไปใช้สแกนได้", () => {
    const code = generateMemberCode();
    const formatted = formatMemberCode(code);
    expect(formatted).toMatch(/^\d{4} \d{4} \d{4} \d{4}$/);
    expect(normalizeMemberCode(formatted)).toBe(code);
    expect(isScannableMemberCode(formatted)).toBe(true);
  });

  it("ยังยอมรับรหัสสมาชิก Mxxxx รุ่นเดิม", () => {
    expect(isScannableMemberCode("m0001")).toBe(true);
  });

  it("อ่านเลข 16 หลักจาก payload ของ Barcode หรือ QR ได้", () => {
    const code = generateMemberCode();
    expect(extractMemberCardCode(`KY-MEMBER:${code}`)).toBe(code);
    expect(extractMemberCardCode(`CARD=${code}`)).toBe(code);
  });

  it("ไม่รับเลข Luhn ที่ไม่ได้ใช้ prefix ของร้าน", () => {
    const foreignBody = "791234567890123";
    expect(
      isLongMemberCode(`${foreignBody}${luhnCheckDigit(foreignBody)}`)
    ).toBe(false);
  });
});
