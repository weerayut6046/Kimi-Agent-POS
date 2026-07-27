/**
 * PromptPay QR (EMVCo Thai QR / Thai QR Payment) payload generator.
 *
 * Pure TypeScript — ไม่มี dependency ภายนอก
 * อ้างอิงโครงสร้าง EMVCo Merchant Presented Mode + ข้อกำหนด PromptPay ของ ธปท.
 *
 * โครงสร้างหลัก (TLV = tag(2) + length(2) + value):
 * - 00 Payload Format Indicator = "01"
 * - 01 Point of Initiation Method = "12" (dynamic, ล็อกยอด) หรือ "11" (static)
 * - 29 Merchant Account Information (PromptPay)
 *     - 00 Application ID: A000000677010111 (เบอร์โทร) / A000000677010114 (เลขบัตรประชาชน)
 *     - 01 เบอร์โทรรูปแบบ 0066xxxxxxxxx (13 หลัก) หรือ 02 เลขบัตรประชาชน 13 หลัก
 * - 53 Transaction Currency = "764" (THB)
 * - 54 Transaction Amount (มีเฉพาะตอนล็อกยอด, ทศนิยม 2 ตำแหน่ง)
 * - 58 Country Code = "TH"
 * - 63 CRC = "04" + CRC16-CCITT (poly 0x1021, init 0xFFFF) ของข้อมูลทั้งหมดถึง "6304"
 */

export type PromptPayIdType = "mobile" | "citizenId";

const PROMPTPAY_AID: Record<PromptPayIdType, string> = {
  mobile: "A000000677010111",
  citizenId: "A000000677010114",
};

function tlv(tag: string, value: string): string {
  if (value.length > 99) {
    throw new Error(`ค่าของฟิลด์ ${tag} ยาวเกินขนาดที่ TLV รองรับ`);
  }
  return `${tag}${String(value.length).padStart(2, "0")}${value}`;
}

/** CRC16-CCITT (0xFFFF): polynomial 0x1021, init 0xFFFF, no reflection, xorout 0 */
export function crc16Ccitt(data: string): number {
  let crc = 0xffff;
  for (let i = 0; i < data.length; i += 1) {
    crc ^= data.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

/**
 * แปลงเบอร์โทรไทยเป็นรูปแบบ PromptPay (0066 + 9 หลัก รวม 13 หลัก)
 * รับทั้ง "0812345678", "+66812345678", "66812345678"
 */
export function normalizePromptPayMobile(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (/^0\d{9}$/.test(digits)) return `0066${digits.slice(1)}`;
  if (/^66\d{9}$/.test(digits)) return `00${digits}`;
  throw new Error("เบอร์โทร PromptPay ต้องเป็นเบอร์ไทย 10 หลัก (ขึ้นต้น 0)");
}

/** ตรวจเลขบัตรประชาชน 13 หลัก (ตัวเลขล้วนเท่านั้น ไม่บังคับ checksum) */
export function normalizePromptPayCitizenId(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (!/^\d{13}$/.test(digits)) {
    throw new Error("เลขบัตรประชาชน PromptPay ต้องเป็นตัวเลข 13 หลัก");
  }
  return digits;
}

/** เดาประเภท PromptPay ID จากความยาว/รูปแบบ (เบอร์ 10 หลักขึ้นต้น 0 = mobile) */
export function detectPromptPayIdType(raw: string): PromptPayIdType {
  const digits = raw.replace(/\D/g, "");
  if (/^0\d{9}$/.test(digits) || /^66\d{9}$/.test(digits)) return "mobile";
  if (/^\d{13}$/.test(digits)) return "citizenId";
  throw new Error(
    "PromptPay ID ต้องเป็นเบอร์โทร 10 หลัก หรือเลขบัตรประชาชน 13 หลัก"
  );
}

export type BuildPromptPayPayloadOptions = {
  /** PromptPay ID — เบอร์โทรไทยหรือเลขบัตรประชาชน */
  promptPayId: string;
  /** ยอดเงินบาทที่ล็อกใน QR (ทศนิยมไม่เกิน 2 ตำแหน่ง) — ไม่ระบุ = ไม่ล็อกยอด */
  amount?: number;
  /** ระบุประเภทเอง ถ้าไม่ระบุจะเดาจากรูปแบบ */
  idType?: PromptPayIdType;
};

/** สร้าง payload ข้อความสำหรับ render เป็น QR (ล็อกยอดเมื่อระบุ amount) */
export function buildPromptPayPayload(
  options: BuildPromptPayPayloadOptions
): string {
  const idType = options.idType ?? detectPromptPayIdType(options.promptPayId);
  const proxyValue =
    idType === "mobile"
      ? normalizePromptPayMobile(options.promptPayId)
      : normalizePromptPayCitizenId(options.promptPayId);

  let amountText: string | null = null;
  if (options.amount != null) {
    if (!Number.isFinite(options.amount) || options.amount <= 0) {
      throw new Error("ยอดเงินต้องมากกว่า 0");
    }
    amountText = options.amount.toFixed(2);
    if (Number(amountText) >= 1_000_000_000) {
      throw new Error("ยอดเงินใหญ่เกินขนาดที่ QR รองรับ");
    }
  }

  const merchantAccount = tlv(
    "29",
    tlv("00", PROMPTPAY_AID[idType]) +
      tlv(idType === "mobile" ? "01" : "02", proxyValue)
  );

  let payload =
    tlv("00", "01") +
    tlv("01", amountText ? "12" : "11") +
    merchantAccount +
    tlv("53", "764");
  if (amountText) payload += tlv("54", amountText);
  payload += tlv("58", "TH");
  payload += "6304";
  return payload + crc16Ccitt(payload).toString(16).toUpperCase().padStart(4, "0");
}

// ============ Merchant QR (EMVCo tag 30 — bill payment AID) ============
//
// บัญชีถุงเงินของร้านรับเงินผ่าน QR ร้านค้า (tag 30, AID A000000677010112)
// ไม่ใช่ PromptPay เบอร์โทรส่วนตัว — เงินที่โอนเข้า QR นี้เข้าบัญชีถุงเงินโดยตรง
// โครงสร้าง tag 30: [00 AID][01 billerId][02 ref1 (รหัสร้านค้า)][03 ref2 (ชื่อบัญชี)]

const MERCHANT_BILL_PAYMENT_AID = "A000000677010112";

export type EmvcoTlv = { tag: string; value: string };

/**
 * parse payload EMVCo เป็นรายการ TLV ตามลำดับ — โยน error ถ้าโครงสร้างเสีย
 * (tag 2 ตัว + length 2 ตัว + value ตามความยาว; tag 63 CRC ต้องยาว 4)
 */
export function parseEmvcoTlv(payload: string): EmvcoTlv[] {
  const items: EmvcoTlv[] = [];
  let cursor = 0;
  while (cursor < payload.length) {
    const tag = payload.slice(cursor, cursor + 2);
    const lengthText = payload.slice(cursor + 2, cursor + 4);
    if (!/^\d{2}$/.test(tag) || !/^\d{2}$/.test(lengthText)) {
      throw new Error("โครงสร้าง QR ไม่ถูกต้อง (ไม่ใช่ EMVCo TLV)");
    }
    const length = Number(lengthText);
    const value = payload.slice(cursor + 4, cursor + 4 + length);
    if (value.length !== length) {
      throw new Error("โครงสร้าง QR ไม่สมบูรณ์ (ความยาวฟิลด์ไม่ตรง)");
    }
    items.push({ tag, value });
    cursor += 4 + length;
  }
  return items;
}

export type MerchantBillInfo = {
  billerId: string;
  /** ref1 — รหัสร้านค้าถุงเงิน */
  ref1: string;
  /** ref2 — ชื่อบัญชี */
  ref2: string;
};

/**
 * อ่านข้อมูลร้านค้าจาก static merchant payload (tag 30)
 * ใช้ทั้งตอน validate ก่อนบันทึกการตั้งค่า และตอนแสดงผลในหน้าตั้งค่า
 */
export function extractMerchantBillInfo(payload: string): MerchantBillInfo {
  const merchant = parseEmvcoTlv(payload.trim()).find(item => item.tag === "30");
  if (!merchant) {
    throw new Error("QR นี้ไม่ใช่ QR ร้านค้า (ไม่พบ tag 30)");
  }
  const sub = parseEmvcoTlv(merchant.value);
  const aid = sub.find(item => item.tag === "00")?.value;
  if (aid !== MERCHANT_BILL_PAYMENT_AID) {
    throw new Error("QR นี้ไม่ใช่ QR ร้านค้าถุงเงิน (AID ไม่ตรง)");
  }
  const billerId = sub.find(item => item.tag === "01")?.value;
  const ref1 = sub.find(item => item.tag === "02")?.value;
  const ref2 = sub.find(item => item.tag === "03")?.value ?? "";
  if (!billerId || !ref1) {
    throw new Error("QR ร้านค้าไม่สมบูรณ์ (ไม่มี biller ID หรือรหัสร้านค้า)");
  }
  return { billerId, ref1, ref2 };
}

function formatQrAmount(amount: number): string {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("ยอดเงินต้องมากกว่า 0");
  }
  const text = amount.toFixed(2); // ล็อกทศนิยม 2 ตำแหน่ง (สตางค์) เสมอ
  if (Number(text) >= 1_000_000_000) {
    throw new Error("ยอดเงินใหญ่เกินขนาดที่ QR รองรับ");
  }
  return text;
}

/**
 * ฉีดยอดเงินเข้า static merchant payload ที่เก็บในการตั้งค่า:
 * ตัด tag 63 (CRC เดิม) ทิ้ง, ใส่/แทน tag 54 หลัง tag 53, แล้วคำนวณ CRC ใหม่
 * คง tag อื่นทั้งหมด (รวม tag 01 initiation method) ตาม QR ต้นฉบับจากแอปถุงเงิน
 */
export function injectAmountIntoMerchantQr(
  staticPayload: string,
  amount: number
): string {
  const amountText = formatQrAmount(amount);
  const items = parseEmvcoTlv(staticPayload.trim()).filter(
    item => item.tag !== "54" && item.tag !== "63"
  );
  // ต้องเป็น merchant QR จริง — กันสลับ payload ผิดประเภท
  extractMerchantBillInfo(staticPayload);
  const amountItem: EmvcoTlv = { tag: "54", value: amountText };
  const currencyIndex = items.findIndex(item => item.tag === "53");
  if (currencyIndex >= 0) items.splice(currencyIndex + 1, 0, amountItem);
  else items.push(amountItem);
  let payload = items.map(item => tlv(item.tag, item.value)).join("");
  payload += "6304";
  return (
    payload + crc16Ccitt(payload).toString(16).toUpperCase().padStart(4, "0")
  );
}

/**
 * สร้าง merchant payload จากชิ้นส่วน (tag 30 bill payment) —
 * runtime จริงใช้ injectAmountIntoMerchantQr กับ payload ต้นฉบับจากแอปถุงเงิน;
 * ฟังก์ชันนี้ใช้ใน test และกรณีต้องสร้าง QR ใหม่ทั้งหมด
 */
export function buildMerchantPayload(options: {
  billerId: string;
  ref1: string;
  ref2: string;
  amount?: number;
}): string {
  const amountText =
    options.amount != null ? formatQrAmount(options.amount) : null;
  const merchantAccount = tlv(
    "30",
    tlv("00", MERCHANT_BILL_PAYMENT_AID) +
      tlv("01", options.billerId) +
      tlv("02", options.ref1) +
      (options.ref2 ? tlv("03", options.ref2) : "")
  );
  let payload =
    tlv("00", "01") +
    tlv("01", "11") +
    merchantAccount +
    tlv("53", "764");
  if (amountText) payload += tlv("54", amountText);
  payload += tlv("58", "TH") + tlv("62", tlv("07", "0000"));
  payload += "6304";
  return (
    payload + crc16Ccitt(payload).toString(16).toUpperCase().padStart(4, "0")
  );
}
