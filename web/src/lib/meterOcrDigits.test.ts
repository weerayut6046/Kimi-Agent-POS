import { describe, expect, it } from "vitest";
import { combineMeterDisplayDigits } from "@contracts/meterOcr";

describe("combineMeterDisplayDigits", () => {
  it.each([
    ["39", "6962.39", "396962.39", 396_962.39],
    ["90", "3971.37", "903971.37", 903_971.37],
    ["42", "0105.81", "420105.81", 420_105.81],
    ["29", "5885.00", "295885.00", 295_885],
    ["84", "74023.1", "8474023.1", 8_474_023.1],
    ["10", "22090.9", "1022090.9", 1_022_090.9],
    ["54", "59273.8", "5459273.8", 5_459_273.8],
    ["1", "10956.4", "110956.4", 110_956.4],
  ])(
    "ต่อเลขด้านบน %s กับเลขด้านล่าง %s ก่อนแปลงเป็นตัวเลข",
    (prefix, main, combinedText, value) => {
      expect(combineMeterDisplayDigits(prefix, main)).toEqual({
        prefixDigits: prefix,
        mainDigits: main,
        combinedText,
        value,
      });
    }
  );

  it.each([
    ["3A", "6962.39"],
    ["39", "69O2.39"],
    ["39", "6962.39.1"],
    ["1234567", "1.0"],
    ["39", ""],
  ])("ปฏิเสธรูปแบบที่ไม่ใช่ตัวเลขมิเตอร์: %s | %s", (prefix, main) => {
    expect(combineMeterDisplayDigits(prefix, main)).toBeNull();
  });
});
