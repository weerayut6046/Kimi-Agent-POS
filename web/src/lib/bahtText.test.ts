import { describe, it, expect } from "vitest";
import { bahtText } from "./bahtText";

describe("bahtText", () => {
  it("จำนวนเต็มพื้นฐาน", () => {
    expect(bahtText(1)).toBe("หนึ่งบาทถ้วน");
    expect(bahtText(10)).toBe("สิบบาทถ้วน");
    expect(bahtText(20)).toBe("ยี่สิบบาทถ้วน");
    expect(bahtText(21)).toBe("ยี่สิบเอ็ดบาทถ้วน");
    expect(bahtText(1000)).toBe("หนึ่งพันบาทถ้วน");
  });

  it("เลข 1 หลักหน่วยอ่านว่า เอ็ด เมื่อมีหลักข้างหน้า", () => {
    expect(bahtText(11)).toBe("สิบเอ็ดบาทถ้วน");
    expect(bahtText(101)).toBe("หนึ่งร้อยเอ็ดบาทถ้วน");
    expect(bahtText(111)).toBe("หนึ่งร้อยสิบเอ็ดบาทถ้วน");
  });

  it("หลักล้านและล้านล้าน", () => {
    expect(bahtText(1000000)).toBe("หนึ่งล้านบาทถ้วน");
    expect(bahtText(1000011)).toBe("หนึ่งล้านสิบเอ็ดบาทถ้วน");
    expect(bahtText(1234567)).toBe("หนึ่งล้านสองแสนสามหมื่นสี่พันห้าร้อยหกสิบเจ็ดบาทถ้วน");
  });

  it("สตางค์", () => {
    expect(bahtText(934.58)).toBe("เก้าร้อยสามสิบสี่บาทห้าสิบแปดสตางค์");
    expect(bahtText(0.5)).toBe("ห้าสิบสตางค์");
    expect(bahtText(0.01)).toBe("หนึ่งสตางค์");
  });

  it("ศูนย์", () => {
    expect(bahtText(0)).toBe("ศูนย์บาทถ้วน");
  });
});
