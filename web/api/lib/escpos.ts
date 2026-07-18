/**
 * ESC/POS command builder สำหรับเครื่องพิมพ์ความร้อน
 * สร้าง raw bytes ตามมาตรฐาน ESC/POS ตรงๆ — ไม่พึ่ง library ภายนอก
 */

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

/** จำนวนตัวอักษรต่อบรรทัดตามขนาดกระดาษ (มม.) */
export const LINE_WIDTHS = { "58": 32, "80": 48 } as const;
export type PaperWidth = keyof typeof LINE_WIDTHS;

/** สระ/วรรณยุกต์ไทยที่รวมกับพยัญชนะตัวก่อนหน้า (ไม่กินความกว้างตอนพิมพ์): U+0E31, U+0E34–U+0E3A, U+0E47–U+0E4E */
function isNonSpacing(ch: string): boolean {
  const cp = ch.codePointAt(0)!;
  return cp === 0x0e31 || (cp >= 0x0e34 && cp <= 0x0e3a) || (cp >= 0x0e47 && cp <= 0x0e4e);
}

/** ความกว้างข้อความเมื่อพิมพ์จริง (ตัวรวมเสียงไม่นับ) — ใช้จัดคอลัมน์ซ้าย/ขวาให้ตรงกัน */
export function displayWidth(s: string): number {
  let w = 0;
  for (const ch of s) if (!isNonSpacing(ch)) w++;
  return w;
}

/**
 * แปลงข้อความเป็น TIS-620 (code page ภาษาไทยของเครื่องพิมพ์)
 * - ASCII (0x20–0x7E) ผ่านตรง
 * - ไทย U+0E01–U+0E5B → byte = codepoint − 0x0E00 + 0xA0 (ครอบ ฿ U+0E3F → 0xDF)
 * - ตัวอื่นที่ map ไม่ได้ → "?"
 */
export function encodeTis620(text: string): Buffer {
  const bytes: number[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp >= 0x20 && cp <= 0x7e) bytes.push(cp);
    else if (cp >= 0x0e01 && cp <= 0x0e5b) bytes.push(cp - 0x0e00 + 0xa0);
    else bytes.push(0x3f);
  }
  return Buffer.from(bytes);
}

/** ตัดข้อความยาวเป็นหลายบรรทัดตามความกว้างพิมพ์ (ตัดกลางคำได้ — ใบเสร็จไม่ซีเรียส) */
export function wrapText(s: string, width: number): string[] {
  const lines: string[] = [];
  let cur = "";
  let curW = 0;
  for (const ch of s) {
    if (curW >= width && !isNonSpacing(ch)) {
      lines.push(cur);
      cur = "";
      curW = 0;
    }
    cur += ch;
    if (!isNonSpacing(ch)) curW++;
  }
  if (cur) lines.push(cur);
  return lines.length > 0 ? lines : [""];
}

export type EscposOptions = {
  /** ขนาดกระดาษ "58" | "80" (มม.) */
  width: PaperWidth;
  /** หมายเลข code page ไทยของเครื่องพิมพ์ (ESC t n) — Epson ไทยมักใช้ 96, Star อาจต่าง ปรับได้ในหน้าตั้งค่า */
  codepage: number;
};

/** ตัวสะสมคำสั่ง ESC/POS ทีละ chunk — build() คืน Buffer พร้อมส่งเข้าเครื่องพิมพ์ */
export class EscposBuilder {
  private chunks: Buffer[] = [];
  readonly lineWidth: number;

  constructor(opts: EscposOptions) {
    this.lineWidth = LINE_WIDTHS[opts.width];
    this.cmd([ESC, 0x40]); // ESC @ — reset เครื่องพิมพ์
    this.cmd([ESC, 0x74, opts.codepage & 0xff]); // ESC t n — เลือก code page ไทย
  }

  private cmd(bytes: number[]) {
    this.chunks.push(Buffer.from(bytes));
  }

  private text(s: string) {
    this.chunks.push(encodeTis620(s));
  }

  align(mode: "left" | "center" | "right") {
    this.cmd([ESC, 0x61, mode === "left" ? 0 : mode === "center" ? 1 : 2]);
    return this;
  }

  bold(on: boolean) {
    this.cmd([ESC, 0x45, on ? 1 : 0]);
    return this;
  }

  /** พิมพ์ข้อความ 1 บรรทัดแล้วขึ้นบรรทัดใหม่ */
  line(s = "") {
    this.text(s);
    this.cmd([LF]);
    return this;
  }

  /** เส้นขีดคั่นเต็มความกว้างกระดาษ */
  divider(ch = "-") {
    return this.line(ch.repeat(this.lineWidth));
  }

  /**
   * แถวซ้าย-ขวา เช่น "รวม ... 1,018.50" — เติม space กลางให้เต็มบรรทัด
   * ถ้ารวมกันยาวเกินบรรทัด ให้ค่าขวาตกไปบรรทัดถัดไปชิดขวา
   */
  row(left: string, right: string) {
    const gap = this.lineWidth - displayWidth(left) - displayWidth(right);
    if (gap >= 1) return this.line(left + " ".repeat(gap) + right);
    this.line(left);
    return this.line(" ".repeat(Math.max(0, this.lineWidth - displayWidth(right))) + right);
  }

  /** เลื่อนกระดาษ n บรรทัด (ESC d n) */
  feed(n = 1) {
    this.cmd([ESC, 0x64, n & 0xff]);
    return this;
  }

  /** เตะลิ้นชักเก็บเงิน (ESC p 0 t1 t2 — ต่อ pin 2 ของพอร์ต RJ11 บนเครื่องพิมพ์) */
  drawerKick() {
    this.cmd([ESC, 0x70, 0, 25, 250]);
    return this;
  }

  /** เลื่อนกระดาษพ้นตำแหน่งตัดแล้วสั่งตัด (GS V 1 = partial cut กันกระดาษฉีกขาด) */
  cut() {
    this.feed(3);
    this.cmd([GS, 0x56, 1]);
    return this;
  }

  build(): Buffer {
    return Buffer.concat(this.chunks);
  }
}
