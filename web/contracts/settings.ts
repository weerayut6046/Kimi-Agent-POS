/**
 * ค่าตั้งต้นที่ทั้งหน้าเว็บ, API, seed และ migration ใช้ร่วมกัน
 * เพื่อไม่ให้หน้า Settings แสดงค่าหนึ่ง แต่ฐานข้อมูลใช้ค่าอีกชุดหนึ่ง
 */
export const DEFAULT_SETTINGS: Readonly<Record<string, string>> = {
  shop_name: "ปั๊มน้ำมันกลางใหญ่บริการ",
  shop_branch: "สาขาหลัก",
  shop_address: "123 ถ.ตัวอย่าง ต.ในเมือง อ.เมือง จ.ขอนแก่น 40000",
  tax_id: "0105566001123",
  shop_phone: "02-123-4567",
  vat_rate: "7",
  point_earn_per_baht: "25",
  point_redeem_value: "1",
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
};

export function mergeSettingDefaults(
  rows: Iterable<readonly [string, string]>
): Record<string, string> {
  return { ...DEFAULT_SETTINGS, ...Object.fromEntries(rows) };
}
