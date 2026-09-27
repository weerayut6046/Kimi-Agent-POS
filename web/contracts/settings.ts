/**
 * ค่าตั้งต้นที่ทั้งหน้าเว็บ, API, seed และ migration ใช้ร่วมกัน
 * เพื่อไม่ให้หน้า Settings แสดงค่าหนึ่ง แต่ฐานข้อมูลใช้ค่าอีกชุดหนึ่ง
 */
export const METER_OCR_MODES = ["local"] as const;
export type MeterOcrMode = (typeof METER_OCR_MODES)[number];

export const APP_TEMPLATE_IDS = ["pumppos", "tailadmin"] as const;
export type AppTemplateId = (typeof APP_TEMPLATE_IDS)[number];

export const DEFAULT_APP_TEMPLATE: AppTemplateId = "pumppos";

export const APP_TEMPLATE_OPTIONS: ReadonlyArray<{
  id: AppTemplateId;
  label: string;
  description: string;
}> = [
  {
    id: "pumppos",
    label: "PumpPOS",
    description: "รูปแบบมาตรฐานสำหรับงานขายและบริหารสถานีบริการน้ำมัน",
  },
  {
    id: "tailadmin",
    label: "TailAdmin",
    description:
      "รูปแบบแดชบอร์ดพร้อมแถบเมนูด้านข้างและพื้นที่ข้อมูลที่อ่านง่าย",
  },
];

export function normalizeAppTemplate(value: unknown): AppTemplateId {
  return typeof value === "string" &&
    APP_TEMPLATE_IDS.includes(value as AppTemplateId)
    ? (value as AppTemplateId)
    : DEFAULT_APP_TEMPLATE;
}

export const APP_THEME_IDS = [
  "command",
  "calm",
  "thai-modern",
  "industrial",
  "ocean",
] as const;
export type AppThemeId = (typeof APP_THEME_IDS)[number];

export const DEFAULT_APP_THEME: AppThemeId = "command";

export const APP_THEME_OPTIONS: ReadonlyArray<{
  id: AppThemeId;
  label: string;
  description: string;
  colors: readonly [string, string, string, string];
}> = [
  {
    id: "command",
    label: "Command Center",
    description: "กรมท่า–Teal คมชัด เหมาะกับงานบริหารสถานี",
    colors: ["#102b3a", "#168c82", "#eef3f6", "#ffffff"],
  },
  {
    id: "calm",
    label: "Calm Counter",
    description: "เขียวธรรมชาติ สะอาด สบายตาสำหรับใช้งานทั้งวัน",
    colors: ["#183528", "#217a55", "#f3f7f3", "#ffffff"],
  },
  {
    id: "thai-modern",
    label: "Thai Modern",
    description: "ม่วงพลัม–กุหลาบ อบอุ่นและมีเอกลักษณ์",
    colors: ["#3a2952", "#a94f62", "#f7f2ec", "#fffdf9"],
  },
  {
    id: "industrial",
    label: "Industrial Pro",
    description: "กราไฟต์–เหลือง เน้นความชัดและการกดบนจอสัมผัส",
    colors: ["#17191a", "#d89d00", "#eaebeb", "#ffffff"],
  },
  {
    id: "ocean",
    label: "Ocean Blue",
    description: "น้ำเงิน–ฟ้า ดูน่าเชื่อถือและอ่านข้อมูลง่าย",
    colors: ["#12304a", "#1675a9", "#eef5f8", "#ffffff"],
  },
];

export function normalizeAppTheme(value: unknown): AppThemeId {
  return typeof value === "string" &&
    APP_THEME_IDS.includes(value as AppThemeId)
    ? (value as AppThemeId)
    : DEFAULT_APP_THEME;
}

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
  app_template: DEFAULT_APP_TEMPLATE,
  app_theme: DEFAULT_APP_THEME,
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
  // เปิด capability ลดต่อลิตรไว้ และควบคุมการใช้งานจริงด้วย promotion_enabled
  promotion_per_liter_feature_enabled: "1",
  promotion_enabled: "0",
  promotion_name: "โปรโมชั่นลดราคาน้ำมัน สิงหาคม 2569",
  promotion_discount: "0.50",
  promotion_start_date: "2026-08-01",
  promotion_end_date: "2026-08-31",
  bill_promotion_enabled: "1",
  bill_promotion_name: "เติมน้ำมันครบ 1,000 บาท ลด 20 บาท",
  bill_promotion_min_fuel_spend: "1000",
  bill_promotion_discount: "20",
  bill_promotion_start_date: "2026-08-01",
  bill_promotion_end_date: "2026-08-31",
  meter_ocr_mode: "local",
};

export function mergeSettingDefaults(
  rows: Iterable<readonly [string, string]>
): Record<string, string> {
  const merged = {
    ...DEFAULT_SETTINGS,
    ...Object.fromEntries(rows),
  };
  return {
    ...merged,
    app_template: normalizeAppTemplate(merged.app_template),
    app_theme: normalizeAppTheme(merged.app_theme),
    // ห้ามค่าเก่าเปิดเส้นทางส่งภาพออกจากเครื่องกลับมาอีก
    meter_ocr_mode: "local",
  };
}
