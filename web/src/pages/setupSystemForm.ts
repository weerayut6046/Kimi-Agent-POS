import {
  setupSystemInput,
  type BusinessSetupSystemSettings,
} from "@contracts/onboarding";

export type SetupSystemDraft = Omit<
  BusinessSetupSystemSettings,
  "vatRate" | "pointEarnPerBaht" | "pointRedeemValue"
> & {
  vatRate: string;
  pointEarnPerBaht: string;
  pointRedeemValue: string;
};

export function setupSystemDraft(
  settings: BusinessSetupSystemSettings
): SetupSystemDraft {
  return {
    ...settings,
    vatRate: String(settings.vatRate),
    pointEarnPerBaht: String(settings.pointEarnPerBaht),
    pointRedeemValue: String(settings.pointRedeemValue),
  };
}

export function setupSystemSaveInput(
  draft: SetupSystemDraft,
  expectedBranchId: number
) {
  const read = (
    value: string,
    label: string,
    max: number,
    allowsZero: boolean
  ) => {
    if (!value.trim()) throw new Error(`กรุณาระบุ${label}`);
    const number = Number(value);
    if (
      !Number.isFinite(number) ||
      number > max ||
      (allowsZero ? number < 0 : number <= 0)
    )
      throw new Error(
        `${label}ต้องเป็นตัวเลข${allowsZero ? "ตั้งแต่ 0" : "มากกว่า 0"} และไม่เกิน ${max}`
      );
    return number;
  };
  const parsed = setupSystemInput.safeParse({
    expectedBranchId,
    receiptPaperSize: draft.receiptPaperSize,
    taxInvoicePaperSize: draft.taxInvoicePaperSize,
    silentPrint: draft.silentPrint,
    vatRate: read(draft.vatRate, "อัตรา VAT", 100, true),
    pointEarnPerBaht: read(
      draft.pointEarnPerBaht,
      "ยอดซื้อที่ใช้สะสมหนึ่งแต้ม",
      1_000_000,
      false
    ),
    pointRedeemValue: read(
      draft.pointRedeemValue,
      "มูลค่าหนึ่งแต้ม",
      1_000_000,
      false
    ),
  });
  if (!parsed.success) throw new Error("ตรวจขนาดกระดาษและค่าการใช้งานอีกครั้ง");
  return parsed.data;
}
