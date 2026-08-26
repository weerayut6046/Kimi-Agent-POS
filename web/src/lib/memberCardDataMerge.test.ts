import { describe, expect, it } from "vitest";
import { buildMemberCardDataMergeCsv } from "./memberCardDataMerge";

describe("member card Data Merge CSV", () => {
  it("ใช้เลขเดียวกันกับตัวเลข Barcode และ QR โดยไม่มีข้อมูลแถบแม่เหล็ก", () => {
    const code = "8884166651235064";
    const csv = buildMemberCardDataMergeCsv([{ memberCode: code }]);
    expect(csv).toContain(
      "record_no,card_number,card_number_display,@barcode_image,@qr_image,status"
    );
    expect(csv).toContain(
      `1,${code},8884 1666 5123 5064,barcode/${code}.png,qr/${code}.png,ยังไม่เปิดใช้งาน`
    );
    expect(csv.toLowerCase()).not.toContain("track");
  });
});
