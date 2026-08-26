/**
 * ค่าตั้งต้นที่ทั้งหน้าเว็บ, API, seed และ migration ใช้ร่วมกัน
 * เพื่อไม่ให้หน้า Settings แสดงค่าหนึ่ง แต่ฐานข้อมูลใช้ค่าอีกชุดหนึ่ง
 */
export const METER_OCR_MODES = ["local"] as const;
export type MeterOcrMode = (typeof METER_OCR_MODES)[number];

export function normalizeMeterOcrMode(_value: unknown): MeterOcrMode {
  // ค่า gemini/auto จากฐานข้อมูลรุ่นเก่าจะถูกบังคับเป็น local เสมอ
  return "local";
}

export const DEFAULT_POINT_EARN_PER_BAHT = 100;
export const DEFAULT_POINT_REDEEM_VALUE = 1;

/** อ่านค่าตัวเลขบวกจาก settings และย้อนกลับไปใช้ค่ามาตรฐานเมื่อข้อมูลไม่ถูกต้อง */
export function positiveSettingNumber(
  value: unknown,
  fallback: number
): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const DEFAULT_SETTINGS: Readonly<Record<string, string>> = {
  shop_name: "ปั๊มน้ำมันกลางใหญ่บริการ",
  shop_branch: "สาขาหลัก",
  shop_address: "123 ถ.ตัวอย่าง ต.ในเมือง อ.เมือง จ.ขอนแก่น 40000",
  tax_id: "0105566001123",
  shop_phone: "02-123-4567",
  vat_rate: "7",
  point_earn_per_baht: String(DEFAULT_POINT_EARN_PER_BAHT),
  point_redeem_value: String(DEFAULT_POINT_REDEEM_VALUE),
  receipt_prefix: "R",
  receipt_next_no: "1",
  tax_invoice_prefix: "T",
  tax_invoice_next_no: "1",
  receipt_paper_size: "80",
  tax_invoice_paper_size: "a4",
  receipt_silent_print: "0",
  lan_enabled: "0",
  backup_auto_enabled: "0",
  backup_auto_time: "23:30",
  backup_auto_keep: "7",
  pay_cash_enabled: "1",
  pay_qr_enabled: "1",
  pay_card_enabled: "1",
  pay_credit_enabled: "1",
  promotion_enabled: "1",
  promotion_name: "โปรโมชั่นลดราคาน้ำมัน สิงหาคม 2569",
  promotion_discount: "0.50",
  promotion_start_date: "2026-08-01",
  promotion_end_date: "2026-08-31",
  meter_ocr_mode: "local",
};

export function mergeSettingDefaults(
  rows: Iterable<readonly [string, string]>
): Record<string, string> {
  return {
    ...DEFAULT_SETTINGS,
    ...Object.fromEntries(rows),
    // ห้ามค่าเก่าเปิดเส้นทางส่งภาพออกจากเครื่องกลับมาอีก
    meter_ocr_mode: "local",
  };
}
