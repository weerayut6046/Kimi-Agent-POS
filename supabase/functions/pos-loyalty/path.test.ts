import { describe, expect, it } from "vitest";
import { isCustomerPointsRequestPath } from "./path";

describe("pos-loyalty public procedure allow-list", () => {
  it("อนุญาตเฉพาะ customerPoints ทั้งแบบเดี่ยวและ batch", () => {
    expect(
      isCustomerPointsRequestPath(
        "/functions/v1/pos-loyalty/membership.customerPoints"
      )
    ).toBe(true);
    expect(
      isCustomerPointsRequestPath(
        "/functions/v1/pos-loyalty/membership.customerPoints,membership.customerPoints"
      )
    ).toBe(true);
  });

  it("ปฏิเสธ procedure หลังบ้านและ path ที่ไม่สมบูรณ์", () => {
    expect(
      isCustomerPointsRequestPath("/functions/v1/pos-loyalty/membership.listMembers")
    ).toBe(false);
    expect(
      isCustomerPointsRequestPath(
        "/functions/v1/pos-loyalty/membership.customerPoints,auth.listStaff"
      )
    ).toBe(false);
    expect(isCustomerPointsRequestPath("/functions/v1/pos-loyalty")).toBe(false);
  });
});
