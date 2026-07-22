import { describe, expect, it } from "vitest";
import {
  createDownloadProgressView,
  describeUpdateError,
  formatUpdateBytes,
} from "./updaterUi";

describe("updater UI helpers", () => {
  it("จัดรูปแบบขนาดไฟล์และความเร็วให้อ่านง่าย", () => {
    expect(formatUpdateBytes(0)).toBe("0 B");
    expect(formatUpdateBytes(1024)).toBe("1.0 KB");
    expect(formatUpdateBytes(117_014_672)).toBe("112 MB");
  });

  it("จำกัดเปอร์เซ็นต์ให้อยู่ระหว่าง 0 ถึง 100", () => {
    expect(
      createDownloadProgressView({
        total: 1000,
        delta: 0,
        transferred: 375,
        percent: 37.5,
        bytesPerSecond: 2048,
      })
    ).toEqual({
      percent: 37.5,
      percentText: "38%",
      transferredText: "375 B",
      totalText: "1000 B",
      speedText: "2.0 KB/วินาที",
    });

    expect(
      createDownloadProgressView({
        total: 1,
        delta: 0,
        transferred: 2,
        percent: 150,
        bytesPerSecond: 0,
      }).percent
    ).toBe(100);
  });

  it("แปลง network/checksum error เป็นคำแนะนำสำหรับผู้ใช้", () => {
    expect(
      describeUpdateError(new Error("net::ERR_HTTP2_SERVER_REFUSED_STREAM"))
    ).toContain("เซิร์ฟเวอร์ปฏิเสธ");
    expect(
      describeUpdateError(new Error("sha512 checksum mismatch"))
    ).toContain("ไฟล์ที่ดาวน์โหลดไม่สมบูรณ์");
    expect(describeUpdateError(new Error("socket closed"))).toContain(
      "socket closed"
    );
  });
});
