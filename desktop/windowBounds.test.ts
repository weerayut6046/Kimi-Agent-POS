import { describe, expect, it } from "vitest";
import { fitWindowToWorkArea } from "./windowBounds";

describe("fitWindowToWorkArea", () => {
  it("ใช้ขนาดมาตรฐานเมื่อจอมีพื้นที่เพียงพอ", () => {
    expect(fitWindowToWorkArea({ width: 1920, height: 1040 })).toEqual({
      width: 1366,
      height: 900,
      minWidth: 720,
      minHeight: 520,
    });
  });

  it("ย่อหน้าต่างเริ่มต้นให้พอดีจอขนาดเล็ก", () => {
    expect(fitWindowToWorkArea({ width: 1024, height: 560 })).toEqual({
      width: 1024,
      height: 560,
      minWidth: 720,
      minHeight: 520,
    });
  });

  it("ไม่บังคับ minimum ให้ใหญ่กว่าพื้นที่จอ", () => {
    expect(fitWindowToWorkArea({ width: 640, height: 450 })).toEqual({
      width: 640,
      height: 450,
      minWidth: 640,
      minHeight: 450,
    });
  });
});
