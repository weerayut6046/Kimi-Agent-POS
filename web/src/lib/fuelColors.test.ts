import { describe, expect, it } from "vitest";
import { getFuelLiquidTone } from "./fuelColors";

describe("getFuelLiquidTone", () => {
  it("ใช้สีส้มกับแก๊สโซฮอล์ 95 จากชื่อหรือรหัสสินค้า", () => {
    expect(getFuelLiquidTone("แก๊สโซฮอล์ 95")).toEqual({
      color: "#f97316",
      light: "#fdba74",
    });
    expect(getFuelLiquidTone("GSH95", "ถังหน้า")).toEqual({
      color: "#f97316",
      light: "#fdba74",
    });
  });

  it("ใช้สีเหลืองกับดีเซล B7 จากชื่อหรือรหัสสินค้า", () => {
    expect(getFuelLiquidTone("ดีเซล B7")).toEqual({
      color: "#eab308",
      light: "#fde047",
    });
    expect(getFuelLiquidTone("DB7", "ถังดีเซลตู้หน้า")).toEqual({
      color: "#eab308",
      light: "#fde047",
    });
  });

  it("รองรับสีของน้ำมันชนิดอื่นและมีสีสำรอง", () => {
    expect(getFuelLiquidTone("แก๊สโซฮอล์ 91").color).toBe("#16a34a");
    expect(getFuelLiquidTone("E20").color).toBe("#65a30d");
    expect(getFuelLiquidTone("ไม่ระบุชนิด")).toEqual({
      color: "#6d5df4",
      light: "#22d3ee",
    });
  });
});
