export const METER_OCR_MAX_SELECTED_IMAGES = 20;

export type MeterDisplayMode = "L" | "P" | "unknown";
export type MeterDisplaySide = "left" | "right";

export type CombinedMeterDisplay = {
  prefixDigits: string;
  mainDigits: string;
  combinedText: string;
  value: number;
};

/**
 * หน้าตู้แบ่งเลขมิเตอร์สะสมเป็นสองบรรทัด เช่น L 39 + 6962.39
 * ต้องต่อเป็น string ก่อนแปลงเป็น number เพื่อรักษาเลขศูนย์นำหน้าบรรทัดล่าง
 */
export function combineMeterDisplayDigits(
  rawPrefixDigits: string,
  rawMainDigits: string
): CombinedMeterDisplay | null {
  const prefixDigits = rawPrefixDigits.trim().replace(/[\s,]/g, "");
  const mainDigits = rawMainDigits.trim().replace(/[\s,]/g, "");

  if (!/^\d{0,6}$/.test(prefixDigits)) return null;
  if (!/^\d{1,10}(?:\.\d{1,3})?$/.test(mainDigits)) return null;

  const combinedText = `${prefixDigits}${mainDigits}`;
  const integerDigits = combinedText.split(".")[0] ?? "";
  if (!integerDigits || integerDigits.length > 15) return null;

  const value = Number(combinedText);
  if (!Number.isFinite(value) || value < 0) return null;

  return {
    prefixDigits,
    mainDigits,
    combinedText,
    value,
  };
}
