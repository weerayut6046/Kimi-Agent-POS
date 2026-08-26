import { describe, expect, it } from "vitest";
import {
  isMemberCardExpired,
  MEMBER_CARD_VALIDITY_YEARS,
} from "./memberExpiry";

describe("member card expiry", () => {
  it("กำหนดอายุบัตรไว้ 1 ปี", () => {
    expect(MEMBER_CARD_VALIDITY_YEARS).toBe(1);
  });

  it("ถือว่าบัตรหมดอายุทันทีเมื่อถึงเวลาที่กำหนด", () => {
    const expiry = new Date("2027-08-26T03:00:00.000Z");
    expect(
      isMemberCardExpired(expiry, new Date("2027-08-26T02:59:59.999Z"))
    ).toBe(false);
    expect(isMemberCardExpired(expiry, expiry)).toBe(true);
    expect(
      isMemberCardExpired(expiry, new Date("2027-08-26T03:00:00.001Z"))
    ).toBe(true);
  });
});
