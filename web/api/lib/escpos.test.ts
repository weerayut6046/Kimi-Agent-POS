import { describe, it, expect } from "vitest";
import { EscposBuilder, displayWidth, encodeTis620, wrapText } from "./escpos";

describe("encodeTis620", () => {
  it("ASCII ผ่านตรง", () => {
    expect(encodeTis620("ABC xyz 123")).toEqual(Buffer.from("ABC xyz 123"));
  });

  it("ภาษาไทย map เป็น TIS-620 (ก = 0xA1, ฮ = 0xCE)", () => {
    expect(encodeTis620("ก")).toEqual(Buffer.from([0xa1]));
    expect(encodeTis620("ฮ")).toEqual(Buffer.from([0xce]));
    // "กข" ต่อกัน
    expect(encodeTis620("กข")).toEqual(Buffer.from([0xa1, 0xa2]));
  });

  it("เครื่องหมายบาท ฿ = 0xDF", () => {
    expect(encodeTis620("฿")).toEqual(Buffer.from([0xdf]));
  });

  it("ตัวที่ map ไม่ได้กลายเป็น ?", () => {
    expect(encodeTis620("€")).toEqual(Buffer.from([0x3f]));
  });
});

describe("displayWidth", () => {
  it("นับ ASCII ทีละ 1", () => {
    expect(displayWidth("1,018.50")).toBe(8);
  });

  it("สระ/วรรณยุกต์ที่รวมเสียงไม่นับความกว้าง", () => {
    expect(displayWidth("น้ำมัน")).toBe(4); // น + ม + น (้ ำ รวมเสียง)
    expect(displayWidth("ดีเซล")).toBe(4);
  });
});

describe("wrapText", () => {
  it("ตัดตามความกว้างพิมพ์ ไม่แยกสระรวมเสียงออกจากพยัญชนะ", () => {
    expect(wrapText("12345678", 4)).toEqual(["1234", "5678"]);
    const lines = wrapText("น้ำมันแก๊สโซฮอล์", 3);
    for (const l of lines) expect(displayWidth(l)).toBeLessThanOrEqual(3);
    expect(lines.join("").replace(/\s/g, "")).toBe("น้ำมันแก๊สโซฮอล์".replace(/\s/g, ""));
  });

  it("ข้อความว่างคืน 1 บรรทัดว่าง", () => {
    expect(wrapText("", 48)).toEqual([""]);
  });
});

describe("EscposBuilder", () => {
  const build = (width: "58" | "80", fn: (p: EscposBuilder) => void) => {
    const p = new EscposBuilder({ width, codepage: 96 });
    fn(p);
    return p.build();
  };

  it("ขึ้นต้นด้วย ESC @ และ ESC t <codepage>", () => {
    const buf = build("80", () => {});
    expect([...buf.subarray(0, 5)]).toEqual([0x1b, 0x40, 0x1b, 0x74, 96]);
  });

  it("row() เติม space กลางให้เต็มบรรทัด (48 ตัวอักษรสำหรับ 80 มม.)", () => {
    const buf = build("80", (p) => p.row("รวม", "1,018.50"));
    const line = buf.subarray(5, buf.length - 1).toString("latin1"); // ตัด LF ท้าย
    // ความยาวต้องเท่า 48 bytes (ภาษาไทย 1 byte/คอลัมน์หลัง encode)
    expect(line.length).toBe(48);
    expect(line.endsWith("1,018.50")).toBe(true);
    expect(line.startsWith("รวม".split("").map((c) => String.fromCharCode(c.codePointAt(0)! - 0x0e00 + 0xa0)).join(""))).toBe(true);
  });

  it("row() ที่ยาวเกินบรรทัด ค่าขวาตกบรรทัดถัดไปชิดขวา", () => {
    const buf = build("58", (p) => p.row("ภาษีมูลค่าเพิ่ม 7% (รวมใน) พิเศษเพิ่มเติม", "65.32"));
    const text = buf.subarray(5).toString("latin1");
    expect(text.endsWith("65.32\n")).toBe(true);
  });

  it("cut() ลงท้ายด้วย feed 3 บรรทัด + GS V 1", () => {
    const buf = build("80", (p) => p.cut());
    expect([...buf.subarray(-6)]).toEqual([0x1b, 0x64, 3, 0x1d, 0x56, 1]);
  });

  it("drawerKick() ส่ง ESC p 0", () => {
    const buf = build("80", (p) => p.drawerKick());
    expect([...buf.subarray(5)]).toEqual([0x1b, 0x70, 0, 25, 250]);
  });
});
