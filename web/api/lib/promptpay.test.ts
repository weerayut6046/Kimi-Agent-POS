import { describe, expect, it } from "vitest";
import {
  buildMerchantPayload,
  buildPromptPayPayload,
  crc16Ccitt,
  detectPromptPayIdType,
  extractMerchantBillInfo,
  injectAmountIntoMerchantQr,
  normalizePromptPayCitizenId,
  normalizePromptPayMobile,
  parseEmvcoTlv,
} from "./promptpay";

/** static merchant payload จริงจากแอปถุงเงินของร้าน (QR ร้านค้า, tag 30 bill payment) */
const OFFICIAL_MERCHANT_QR =
  "00020101021130830016A0000006770101120115010753700088205021922141170560220009090317WEERAYUTNAMWONGSA53037645802TH62080704000063046EAD";

/** ตรวจว่า payload จบด้วย CRC16 ที่ถูกต้อง */
const expectValidCrc = (payload: string) => {
  const body = payload.slice(0, -4);
  const crc = payload.slice(-4);
  expect(body.endsWith("6304")).toBe(true);
  expect(crc16Ccitt(body).toString(16).toUpperCase().padStart(4, "0")).toBe(crc);
};

describe("crc16Ccitt", () => {
  it("คำนวณ CRC16-CCITT (0xFFFF) ตรงตาม reference vector", () => {
    // reference vectors คำนวณจาก implementation อิสระ (poly 0x1021, init 0xFFFF)
    expect(
      crc16Ccitt(
        "00020101021229370016A0000006770101110113006681234567853037645406100.005802TH6304"
      ).toString(16).toUpperCase().padStart(4, "0")
    ).toBe("F142");
    expect(
      crc16Ccitt(
        "00020101021129370016A0000006770101110113006681234567853037645802TH6304"
      ).toString(16).toUpperCase().padStart(4, "0")
    ).toBe("823E");
  });
});

describe("normalizePromptPayMobile", () => {
  it("แปลงเบอร์ไทย 10 หลักเป็น 0066xxxxxxxxx", () => {
    expect(normalizePromptPayMobile("0812345678")).toBe("0066812345678");
    expect(normalizePromptPayMobile("081-234-5678")).toBe("0066812345678");
  });

  it("รับรูปแบบ 66xxxxxxxxx", () => {
    expect(normalizePromptPayMobile("+66812345678")).toBe("0066812345678");
  });

  it("เบอร์ผิดรูปแบบ → error", () => {
    expect(() => normalizePromptPayMobile("12345")).toThrow();
  });
});

describe("normalizePromptPayCitizenId", () => {
  it("รับเลข 13 หลัก", () => {
    expect(normalizePromptPayCitizenId("1-1017-00200-00-0")).toBe(
      "1101700200000"
    );
  });
  it("ความยาวไม่ครบ → error", () => {
    expect(() => normalizePromptPayCitizenId("12345")).toThrow();
  });
});

describe("detectPromptPayIdType", () => {
  it("เบอร์ 10 หลักขึ้นต้น 0 = mobile, เลข 13 หลัก = citizenId", () => {
    expect(detectPromptPayIdType("0812345678")).toBe("mobile");
    expect(detectPromptPayIdType("1101700200000")).toBe("citizenId");
  });
});

describe("buildPromptPayPayload", () => {
  it("เบอร์โทร + ล็อกยอด → payload ตรง reference string", () => {
    expect(buildPromptPayPayload({ promptPayId: "0812345678", amount: 100 })).toBe(
      "00020101021229370016A0000006770101110113006681234567853037645406100.005802TH6304F142"
    );
  });

  it("เบอร์โทร ไม่ล็อกยอด → static QR (initiation method 11)", () => {
    expect(buildPromptPayPayload({ promptPayId: "0812345678" })).toBe(
      "00020101021129370016A0000006770101110113006681234567853037645802TH6304823E"
    );
  });

  it("เลขบัตรประชาชน + ล็อกยอดทศนิยม → payload ตรง reference string", () => {
    expect(
      buildPromptPayPayload({ promptPayId: "1101700200000", amount: 25.5 })
    ).toBe(
      "00020101021229370016A000000677010114021311017002000005303764540525.505802TH63043696"
    );
  });

  it("ยอดเงินปัดเป็นทศนิยม 2 ตำแหน่งเสมอ", () => {
    const payload = buildPromptPayPayload({
      promptPayId: "0812345678",
      amount: 407.4,
    });
    expect(payload).toContain("5406407.40");
  });

  it("ยอดเงินไม่ถูกต้อง → error", () => {
    expect(() =>
      buildPromptPayPayload({ promptPayId: "0812345678", amount: 0 })
    ).toThrow();
    expect(() =>
      buildPromptPayPayload({ promptPayId: "0812345678", amount: -5 })
    ).toThrow();
  });

  it("PromptPay ID ผิดรูปแบบ → error", () => {
    expect(() => buildPromptPayPayload({ promptPayId: "abc" })).toThrow();
  });
});

describe("merchant QR (EMVCo tag 30 — บัญชีถุงเงิน)", () => {
  it("parseEmvcoTlv อ่าน payload จริงครบทุก tag", () => {
    const tags = parseEmvcoTlv(OFFICIAL_MERCHANT_QR).map(item => item.tag);
    expect(tags).toEqual(["00", "01", "30", "53", "58", "62", "63"]);
  });

  it("extractMerchantBillInfo อ่าน billerId / ref1 (รหัสร้านค้า) / ref2 (ชื่อบัญชี)", () => {
    expect(extractMerchantBillInfo(OFFICIAL_MERCHANT_QR)).toEqual({
      billerId: "010753700088205",
      ref1: "2214117056022000909",
      ref2: "WEERAYUTNAMWONGSA",
    });
  });

  it("extractMerchantBillInfo ปฏิเสธ payload ที่ไม่ใช่ QR ร้านค้า", () => {
    // PromptPay QR (tag 29) — ไม่มี tag 30
    expect(() =>
      extractMerchantBillInfo(
        buildPromptPayPayload({ promptPayId: "0812345678" })
      )
    ).toThrow("ไม่ใช่ QR ร้านค้า");
    expect(() => extractMerchantBillInfo("not-a-qr")).toThrow();
  });

  it("buildMerchantPayload สร้าง payload ตรง QR จริงจากแอปถุงเงินแบบ byte-for-byte", () => {
    expect(
      buildMerchantPayload({
        billerId: "010753700088205",
        ref1: "2214117056022000909",
        ref2: "WEERAYUTNAMWONGSA",
      })
    ).toBe(OFFICIAL_MERCHANT_QR);
  });

  it("injectAmountIntoMerchantQr ฉีดยอดลง static QR แล้วโครงสร้าง+CRC ถูกต้อง", () => {
    const injected = injectAmountIntoMerchantQr(OFFICIAL_MERCHANT_QR, 1);
    const tags = parseEmvcoTlv(injected).map(item => item.tag);
    // tag 54 อยู่หลัง tag 53 และ tag 30/62 คงเดิม
    expect(tags).toEqual(["00", "01", "30", "53", "54", "58", "62", "63"]);
    expect(injected).toContain("54041.00");
    expect(injected).toContain(
      "30830016A0000006770101120115010753700088205021922141170560220009090317WEERAYUTNAMWONGSA"
    );
    expectValidCrc(injected);
    // ข้อมูลร้านค้ายังอ่านได้เหมือนเดิมหลังฉีดยอด
    expect(extractMerchantBillInfo(injected)).toEqual(
      extractMerchantBillInfo(OFFICIAL_MERCHANT_QR)
    );
  });

  it("injectAmountIntoMerchantQr จัดรูปแบบสตางค์ 2 ตำแหน่งเสมอและฉีดซ้ำได้ (idempotent)", () => {
    const first = injectAmountIntoMerchantQr(OFFICIAL_MERCHANT_QR, 407.4);
    expect(first).toContain("5406407.40");
    expectValidCrc(first);
    // ฉีดซ้ำบนผลลัพธ์เดิม — tag 54 ต้องถูกแทนที่ ไม่ใช่เพิ่มซ้ำ
    const second = injectAmountIntoMerchantQr(first, 25.5);
    expect(second).toContain("540525.50");
    expect(second).not.toContain("5406407.40");
    expect(
      parseEmvcoTlv(second).filter(item => item.tag === "54")
    ).toHaveLength(1);
    expectValidCrc(second);
  });

  it("injectAmountIntoMerchantQr ปฏิเสธยอดไม่ถูกต้องและ payload เสีย", () => {
    expect(() => injectAmountIntoMerchantQr(OFFICIAL_MERCHANT_QR, 0)).toThrow();
    expect(() => injectAmountIntoMerchantQr(OFFICIAL_MERCHANT_QR, -1)).toThrow();
    expect(() => injectAmountIntoMerchantQr("junk", 1)).toThrow();
  });
});
