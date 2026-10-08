import { z } from "zod";
import type { StaffRole } from "./menuPermissions";

export const BUSINESS_SETUP_KEY = "business_setup_v1";
export const BUSINESS_SETUP_STEPS = [
  "profile",
  "products",
  "staff",
  "payments",
  "system",
] as const;
export type BusinessSetupStep = (typeof BUSINESS_SETUP_STEPS)[number];

export const setupProgressSchema = z.object({
  version: z.literal(1),
  confirmed: z.object({
    profile: z.boolean(),
    products: z.boolean(),
    staff: z.boolean(),
    payments: z.boolean(),
    system: z.boolean().default(false),
  }),
  completedAt: z.iso.datetime().nullable(),
});
export type BusinessSetupProgress = z.infer<typeof setupProgressSchema>;

export const setupBranchInput = z
  .object({
    expectedBranchId: z.number().int().positive(),
  })
  .strict();
export const setupConfirmStepInput = setupBranchInput.extend({
  step: z.enum(BUSINESS_SETUP_STEPS),
});

export function readSetupProgress(
  value: string | null | undefined
): BusinessSetupProgress {
  try {
    const parsed = setupProgressSchema.safeParse(JSON.parse(value ?? ""));
    if (parsed.success) {
      const stored = JSON.parse(value ?? "");
      if (
        stored.confirmed.system === undefined &&
        parsed.data.completedAt &&
        ["profile", "products", "staff", "payments"].every(
          key => stored.confirmed[key] === true
        )
      )
        parsed.data.confirmed.system = true;
      return parsed.data;
    }
  } catch {
    // Missing or malformed old settings never imply that setup is complete.
  }
  return {
    version: 1,
    confirmed: {
      profile: false,
      products: false,
      staff: false,
      payments: false,
      system: false,
    },
    completedAt: null,
  };
}

export const setupProfileInput = z
  .object({
    expectedBranchId: z.number().int().positive(),
    shopName: z.string().trim().min(1, "กรุณาระบุชื่อกิจการ").max(160),
    branchName: z.string().trim().min(1, "กรุณาระบุชื่อสาขา").max(120),
    address: z.string().trim().max(500),
    phone: z.string().trim().max(40),
    taxId: z.string().trim().max(30),
  })
  .strict();
export type BusinessSetupProfile = Omit<
  z.infer<typeof setupProfileInput>,
  "expectedBranchId"
>;

export const setupPaymentsInput = z
  .object({
    expectedBranchId: z.number().int().positive(),
    cashEnabled: z.boolean(),
    qrEnabled: z.boolean(),
    cardEnabled: z.boolean(),
    creditEnabled: z.boolean(),
    // Omission preserves the receiver configuration, merchant mode and secrets.
    promptpayId: z.string().trim().max(20).optional(),
  })
  .strict()
  .refine(
    input =>
      input.cashEnabled ||
      input.qrEnabled ||
      input.cardEnabled ||
      input.creditEnabled,
    "กรุณาเลือกช่องทางรับเงินอย่างน้อยหนึ่งช่องทาง"
  );
export type BusinessSetupPaymentsInput = z.infer<typeof setupPaymentsInput>;

export const setupSystemInput = setupBranchInput.extend({
  receiptPaperSize: z.enum(["58", "80"]),
  taxInvoicePaperSize: z.enum(["a4", "a5"]),
  silentPrint: z.boolean(),
  vatRate: z.number().finite().min(0).max(100),
  pointEarnPerBaht: z.number().finite().positive().max(1_000_000),
  pointRedeemValue: z.number().finite().positive().max(1_000_000),
});
export type BusinessSetupSystemSettings = Omit<
  z.infer<typeof setupSystemInput>,
  "expectedBranchId"
>;

export const setupFuelInput = z
  .object({
    expectedBranchId: z.number().int().positive(),
    requestId: z.uuid(),
    productId: z.number().int().positive(),
    pumpName: z.string().trim().min(1).max(100),
    tankName: z.string().trim().min(1).max(100),
    nozzleLabel: z.string().trim().min(1).max(100),
    capacityLiters: z.number().finite().positive().max(10_000_000),
    currentLiters: z.number().finite().nonnegative().max(10_000_000),
    lowAlertAt: z.number().finite().nonnegative().max(10_000_000),
    meter: z.number().finite().nonnegative().max(1_000_000_000),
    money: z.number().finite().nonnegative().max(1_000_000_000_000),
  })
  .strict()
  .refine(
    input =>
      input.currentLiters <= input.capacityLiters &&
      input.lowAlertAt <= input.capacityLiters,
    "ระดับน้ำมันและจุดแจ้งเตือนต้องไม่เกินความจุถัง"
  );
export type BusinessSetupFuelInput = z.infer<typeof setupFuelInput>;

export const setupEquipmentInput = setupBranchInput
  .extend({
    nozzleId: z.number().int().positive(),
    label: z.string().trim().min(1).max(100).optional(),
    meter: z.number().finite().nonnegative().max(1_000_000_000).optional(),
    money: z.number().finite().nonnegative().max(1_000_000_000_000).optional(),
    active: z.boolean().optional(),
    tankName: z.string().trim().min(1).max(100).optional(),
    capacityLiters: z.number().finite().positive().max(10_000_000).optional(),
    currentLiters: z.number().finite().nonnegative().max(10_000_000).optional(),
    lowAlertAt: z.number().finite().nonnegative().max(10_000_000).optional(),
  })
  .refine(
    input =>
      Object.entries(input).some(
        ([key, value]) =>
          key !== "expectedBranchId" &&
          key !== "nozzleId" &&
          value !== undefined
      ),
    "กรุณาระบุค่าที่ต้องการแก้ไข"
  );

export type BusinessSetupReadiness = {
  ready: boolean;
  issues: string[];
};

/** A deliberately small, secret-free snapshot for the owner's setup page. */
export type BusinessSetupState = {
  branch: { id: number; code: string; name: string; active: boolean };
  profile: BusinessSetupProfile;
  products: Array<{
    id: number;
    code: string;
    name: string;
    category: "fuel" | "lubricant" | "other";
    unit: string;
    price: number;
    cost: number;
    stockQty: number;
    active: boolean;
  }>;
  equipment: Array<{
    id: number;
    label: string;
    productId: number;
    productName: string;
    pumpName: string;
    tankName: string;
    meter: number;
    money: number;
    currentLiters: number;
    capacityLiters: number;
    lowAlertAt: number;
    active: boolean;
    valid: boolean;
    issues: string[];
  }>;
  staff: Array<{
    id: number;
    name: string;
    username: string;
    role: StaffRole;
    active: boolean;
    pinReady: boolean;
    authReady: boolean;
    loginReady: boolean;
    isCurrentUser: boolean;
  }>;
  payments: {
    cashEnabled: boolean;
    qrEnabled: boolean;
    cardEnabled: boolean;
    creditEnabled: boolean;
    promptpayId: string;
    qrMode: "promptpay" | "merchant";
    hasMerchantQr: boolean;
    thungngernEnabled: boolean;
    qrReady: boolean;
  };
  progress: BusinessSetupProgress;
  systemSettings: BusinessSetupSystemSettings;
  readiness: Record<BusinessSetupStep, BusinessSetupReadiness>;
  warnings: string[];
  hasOpenShift: boolean;
};
