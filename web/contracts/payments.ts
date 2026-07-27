/**
 * types ที่ใช้ร่วมกันของโมดูลชำระเงิน QR ถุงเงิน (Krungthai Thungngern)
 * ใช้ทั้งฝั่ง API (session snapshot), frontend (dialog) และ schema (jsonb)
 */

export type ThungngernSessionStatus =
  | "pending"
  | "confirmed"
  | "expired"
  | "cancelled";

export type PaymentConfirmedBy = "auto" | "manual" | "webhook";

export type ThungngernSaleItemSnapshot = {
  productId: number;
  name: string;
  qty: number;
  unit: string;
  unitPrice: number;
  amount: number;
  category: "fuel" | "lubricant" | "other";
};

/**
 * snapshot ของบิล ณ ตอนสร้าง session — finalize จะสร้างบิลจากข้อมูลชุดนี้เท่านั้น
 * (ราคาคำนวณฝั่งเซิร์ฟเวอร์ตอนสร้าง session แล้วล็อกไว้กับยอด QR)
 */
export type ThungngernSaleSnapshot = {
  items: ThungngernSaleItemSnapshot[];
  subtotal: number;
  discount: number;
  vatRate: number;
  vatAmount: number;
  total: number;
  memberId: number | null;
  pointsToRedeem: number;
  pointsEarned: number;
  shiftId: number | null;
  staffName: string;
};

export type ThungngernSessionView = {
  id: number;
  refCode: string;
  status: ThungngernSessionStatus;
  amount: number;
  expiresAt: Date;
  secondsLeft: number;
  confirmedBy: PaymentConfirmedBy | null;
  externalRef: string | null;
};

/** โหมด QR: promptpay = พร้อมเพย์ส่วนตัว (tag 29), merchant = QR ร้านค้าถุงเงิน (tag 30) */
export type ThungngernQrMode = "promptpay" | "merchant";

export type MerchantBillInfoView = {
  billerId: string;
  /** ref1 — รหัสร้านค้าถุงเงิน */
  ref1: string;
  /** ref2 — ชื่อบัญชี */
  ref2: string;
};

export type PaymentConfigSummary = {
  thungngernEnabled: boolean;
  promptpayId: string;
  qrMode: ThungngernQrMode;
  /** static merchant payload ต้นฉบับ (โหมด merchant; ไม่ใช่ข้อมูลลับ — เป็น QR ที่ติดหน้าร้าน) */
  merchantPayload: string;
  /** ข้อมูลร้านค้าที่ parse จาก merchantPayload (null ถ้าไม่ใช่โหมด merchant หรือ payload ว่าง) */
  merchant: MerchantBillInfoView | null;
  /** provider ตรวจสลิป — ปัจจุบัน "slip2go" เสมอ */
  provider: string;
  apiSecretConfigured: boolean;
  apiKeySource: "settings" | "environment" | "none";
  settingsSource: "settings" | "environment";
  mockMode: boolean;
  /** สาขาของการตั้งค่า — ใช้ประกอบ URL webhook ให้แอปแจ้งเงินเข้า */
  branchId: number;
  /** ตั้ง webhook token แล้วหรือยัง (รับแจ้งเงินเข้าจากแอปบนมือถือ) */
  webhookConfigured: boolean;
  /** token สำหรับตั้งในแอปแจ้งเงินเข้า — เฉพาะ endpoint ระดับ admin เท่านั้นที่ได้ค่าจริง */
  webhookToken: string | null;
};
