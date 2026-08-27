export type ActiveReceiptPromotion = {
  name: string;
  discountPerLiter: number;
};

export type AppliedReceiptPromotion = ActiveReceiptPromotion & {
  liters: number;
  discount: number;
};

export type ActiveBillThresholdPromotion = {
  name: string;
  minimumFuelSpend: number;
  discount: number;
};

export type AppliedBillThresholdPromotion = ActiveBillThresholdPromotion & {
  fuelSpend: number;
  appliedDiscount: number;
};

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isDateKey(value: string): boolean {
  if (!DATE_KEY_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

/** คืนวันที่ปฏิทินตามเวลาไทย เพื่อไม่ให้โปรโมชั่นเปลี่ยนวันตอน 00:00 UTC */
export function bangkokDateKey(value: Date | string | number): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Bangkok",
  }).formatToParts(new Date(value));
  const year = parts.find(part => part.type === "year")?.value;
  const month = parts.find(part => part.type === "month")?.value;
  const day = parts.find(part => part.type === "day")?.value;
  return year && month && day ? `${year}-${month}-${day}` : "";
}

export function promotionSettingsValidationMessage(
  settings: Readonly<Record<string, string>>
): string | null {
  if (settings.promotion_enabled !== "1") return null;

  if (!settings.promotion_name?.trim()) {
    return "กรุณาระบุชื่อโปรโมชั่น";
  }
  const discount = Number(settings.promotion_discount);
  if (!Number.isFinite(discount) || discount <= 0) {
    return "ส่วนลดโปรโมชั่นต่อลิตรต้องมากกว่า 0 บาท";
  }
  if (Math.abs(Math.round(discount * 100) - discount * 100) > 1e-8) {
    return "ส่วนลดโปรโมชั่นต่อลิตรระบุได้ไม่เกิน 2 ตำแหน่งทศนิยม";
  }

  const startDate = settings.promotion_start_date ?? "";
  const endDate = settings.promotion_end_date ?? "";
  if (!isDateKey(startDate) || !isDateKey(endDate)) {
    return "กรุณาระบุวันเริ่มและวันสิ้นสุดโปรโมชั่น";
  }
  if (startDate > endDate) {
    return "วันสิ้นสุดโปรโมชั่นต้องไม่ก่อนวันเริ่ม";
  }
  return null;
}

export function billPromotionSettingsValidationMessage(
  settings: Readonly<Record<string, string>>
): string | null {
  if (settings.bill_promotion_enabled !== "1") return null;

  if (!settings.bill_promotion_name?.trim()) {
    return "กรุณาระบุชื่อโปรโมชั่น";
  }
  const minimumFuelSpend = Number(settings.bill_promotion_min_fuel_spend);
  if (!Number.isFinite(minimumFuelSpend) || minimumFuelSpend <= 0) {
    return "ยอดเติมน้ำมันขั้นต่ำต้องมากกว่า 0 บาท";
  }
  const discount = Number(settings.bill_promotion_discount);
  if (!Number.isFinite(discount) || discount <= 0) {
    return "ส่วนลดโปรโมชั่นต้องมากกว่า 0 บาท";
  }
  if (
    Math.abs(Math.round(minimumFuelSpend * 100) - minimumFuelSpend * 100) >
      1e-8 ||
    Math.abs(Math.round(discount * 100) - discount * 100) > 1e-8
  ) {
    return "ยอดขั้นต่ำและส่วนลดระบุได้ไม่เกิน 2 ตำแหน่งทศนิยม";
  }
  if (discount > minimumFuelSpend) {
    return "ส่วนลดต้องไม่มากกว่ายอดเติมน้ำมันขั้นต่ำ";
  }

  const startDate = settings.bill_promotion_start_date ?? "";
  const endDate = settings.bill_promotion_end_date ?? "";
  if (!isDateKey(startDate) || !isDateKey(endDate)) {
    return "กรุณาระบุวันเริ่มและวันสิ้นสุดโปรโมชั่น";
  }
  if (startDate > endDate) {
    return "วันสิ้นสุดโปรโมชั่นต้องไม่ก่อนวันเริ่ม";
  }
  return null;
}

/** อ่านโปรโมชั่นส่วนลดคงที่ต่อบิลที่กำลังใช้งาน ณ เวลาที่ระบุ */
export function activeReceiptPromotion(
  settings: Readonly<Record<string, string>> | null | undefined,
  at: Date | string | number = new Date()
): ActiveReceiptPromotion | null {
  if (
    !settings ||
    settings.promotion_per_liter_feature_enabled !== "1" ||
    settings.promotion_enabled !== "1" ||
    promotionSettingsValidationMessage(settings)
  )
    return null;

  const date = bangkokDateKey(at);
  if (
    !date ||
    date < settings.promotion_start_date ||
    date > settings.promotion_end_date
  ) {
    return null;
  }

  return {
    name: settings.promotion_name.trim(),
    discountPerLiter:
      Math.round(Number(settings.promotion_discount) * 100) / 100,
  };
}

/** โปรโมชั่นหลัก: เมื่อยอดสินค้าหมวดน้ำมันถึงเกณฑ์ ให้ส่วนลดคงที่ท้ายบิล */
export function activeBillThresholdPromotion(
  settings: Readonly<Record<string, string>> | null | undefined,
  at: Date | string | number = new Date()
): ActiveBillThresholdPromotion | null {
  if (
    !settings ||
    settings.bill_promotion_enabled !== "1" ||
    billPromotionSettingsValidationMessage(settings)
  )
    return null;

  const date = bangkokDateKey(at);
  if (
    !date ||
    date < settings.bill_promotion_start_date ||
    date > settings.bill_promotion_end_date
  ) {
    return null;
  }

  return {
    name: settings.bill_promotion_name.trim(),
    minimumFuelSpend:
      Math.round(Number(settings.bill_promotion_min_fuel_spend) * 100) / 100,
    discount: Math.round(Number(settings.bill_promotion_discount) * 100) / 100,
  };
}

/** จำกัดส่วนลดไม่ให้โปรโมชั่นทำให้ยอดหลังส่วนลดติดลบ */
export function appliedPromotionDiscount(
  promotion: ActiveReceiptPromotion | null,
  fuelLiters: number,
  subtotal: number,
  otherDiscount = 0
): number {
  if (!promotion || fuelLiters <= 0) return 0;
  const remaining = Math.max(0, subtotal - Math.max(0, otherDiscount));
  const promotionAmount = promotion.discountPerLiter * fuelLiters;
  return Math.round(Math.min(promotionAmount, remaining) * 100) / 100;
}

export function appliedBillThresholdPromotionDiscount(
  promotion: ActiveBillThresholdPromotion | null,
  fuelSpend: number,
  subtotal: number,
  otherDiscount = 0
): number {
  if (!promotion || fuelSpend < promotion.minimumFuelSpend) return 0;
  const remaining = Math.max(0, subtotal - Math.max(0, otherDiscount));
  return Math.round(Math.min(promotion.discount, remaining) * 100) / 100;
}
