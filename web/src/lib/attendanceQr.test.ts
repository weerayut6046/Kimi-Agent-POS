import { describe, expect, it } from "vitest";
import { attendanceQrUrl, attendanceTokenFromPayload } from "./attendanceQr";

describe("attendance QR payload", () => {
  const token = "PUMPATT1.payload.signature";

  it("accepts raw tokens and attendance URLs", () => {
    expect(attendanceTokenFromPayload(token)).toBe(token);
    const url = attendanceQrUrl("https://pos.example.com", token);
    expect(url).toBe(
      "https://pos.example.com/attendance?token=PUMPATT1.payload.signature"
    );
    expect(attendanceTokenFromPayload(url)).toBe(token);
  });

  it("rejects unrelated links and payloads", () => {
    expect(
      attendanceTokenFromPayload("https://pos.example.com/pos?token=x")
    ).toBeNull();
    expect(attendanceTokenFromPayload("not-an-attendance-code")).toBeNull();
  });
});
