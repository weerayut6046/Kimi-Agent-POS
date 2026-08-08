import { describe, expect, it } from "vitest";
import { bangkokMonthKey } from "./bangkokMonth";

describe("bangkokMonthKey", () => {
  it("จัดกะช่วงรอยต่อเดือนไปยังเดือนตามเวลาไทย", () => {
    expect(bangkokMonthKey("2026-07-31T16:59:59Z")).toBe("2026-07");
    expect(bangkokMonthKey("2026-07-31T17:00:00Z")).toBe("2026-08");
  });
});
