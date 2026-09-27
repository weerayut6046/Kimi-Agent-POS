import type { BusinessSetupState } from "@contracts/onboarding";
import {
  createProductUpdatePatch,
  type EditableProductValues,
} from "./settingsForm";

export type SetupProduct = BusinessSetupState["products"][number];
export type SetupEquipment = BusinessSetupState["equipment"][number];
export type SetupEquipmentDraft = {
  label: string;
  tankName: string;
  meter: string;
  money: string;
  capacityLiters: string;
  currentLiters: string;
  lowAlertAt: string;
  active: boolean;
};

export function setupEquipmentDraft(item: SetupEquipment): SetupEquipmentDraft {
  return {
    label: item.label,
    tankName: item.tankName,
    meter: String(item.meter),
    money: String(item.money),
    capacityLiters: String(item.capacityLiters),
    currentLiters: String(item.currentLiters),
    lowAlertAt: String(item.lowAlertAt),
    active: item.active,
  };
}

export function setupEquipmentPatch(
  draft: SetupEquipmentDraft,
  initial: SetupEquipment
) {
  const read = (value: string): number => {
    if (!value.trim() || !Number.isFinite(Number(value)) || Number(value) < 0) {
      throw new Error("กรุณาระบุเลข L/P และระดับน้ำมันจริงตั้งแต่ 0 ขึ้นไป");
    }
    return Number(value);
  };
  const values = {
    label: draft.label.trim(),
    tankName: draft.tankName.trim(),
    active: draft.active,
    meter: read(draft.meter),
    money: read(draft.money),
    capacityLiters: read(draft.capacityLiters),
    currentLiters: read(draft.currentLiters),
    lowAlertAt: read(draft.lowAlertAt),
  };
  const tankChanged =
    values.capacityLiters !== initial.capacityLiters ||
    values.currentLiters !== initial.currentLiters ||
    values.lowAlertAt !== initial.lowAlertAt;
  if (
    (values.active || tankChanged) &&
    (values.capacityLiters <= 0 ||
      values.currentLiters > values.capacityLiters ||
      values.lowAlertAt > values.capacityLiters)
  ) {
    throw new Error(
      "ความจุถังต้องมากกว่า 0 และระดับน้ำมันกับจุดแจ้งเตือนต้องไม่เกินความจุถัง"
    );
  }
  if ((values.active || values.label !== initial.label) && !values.label)
    throw new Error("กรุณาระบุชื่อหัวจ่าย");
  if (
    (values.active || values.tankName !== initial.tankName) &&
    !values.tankName
  )
    throw new Error("กรุณาระบุชื่อถัง");
  const patch: { nozzleId: number } & Partial<typeof values> = {
    nozzleId: initial.id,
  };
  for (const key of Object.keys(values) as Array<keyof typeof values>) {
    if (values[key] !== initial[key])
      Object.assign(patch, { [key]: values[key] });
  }
  return patch;
}
export type SetupProductDraft = {
  code: string;
  name: string;
  category: SetupProduct["category"];
  unit: string;
  price: string;
  cost: string;
  stockQty: string;
  active: boolean;
};

export function setupProductDraft(product?: SetupProduct): SetupProductDraft {
  return {
    code: product?.code ?? "",
    name: product?.name ?? "",
    category: product?.category ?? "fuel",
    unit: product?.unit ?? "ลิตร",
    price: product ? String(product.price) : "",
    cost: product ? String(product.cost) : "",
    stockQty: product ? String(product.stockQty) : "",
    active: product?.active ?? true,
  };
}

export function parseSetupProduct(
  draft: SetupProductDraft,
  id?: number
): EditableProductValues {
  const readNumber = (value: string, label: string): number => {
    if (value.trim() === "") throw new Error(`กรุณาระบุ${label}`);
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new Error(`${label}ต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป`);
    }
    return parsed;
  };
  if (!draft.code.trim() || !draft.name.trim() || !draft.unit.trim()) {
    throw new Error("กรุณาระบุรหัส ชื่อสินค้า และหน่วยขาย");
  }
  return {
    id,
    code: draft.code.trim(),
    name: draft.name.trim(),
    category: draft.category,
    unit: draft.unit.trim(),
    price: readNumber(draft.price, "ราคาขาย"),
    cost: readNumber(draft.cost, "ต้นทุน"),
    stockQty:
      draft.category === "fuel" ? 0 : readNumber(draft.stockQty, "จำนวนสินค้า"),
    // The setup snapshot deliberately omits the existing low-stock threshold.
    // Give both sides the same placeholder so PATCH can never overwrite it.
    lowStockAt: 0,
    active: draft.active,
  };
}

export function setupProductPatch(
  draft: SetupProductDraft,
  initial: SetupProduct
) {
  const current = parseSetupProduct(draft, initial.id);
  if (initial.category === "fuel") current.stockQty = initial.stockQty;
  return createProductUpdatePatch(current, { ...initial, lowStockAt: 0 });
}

export function setupErrorMessage(error: unknown): string {
  const message =
    error instanceof Error ? error.message : "บันทึกไม่สำเร็จ กรุณาลองใหม่";
  try {
    const issues: unknown = JSON.parse(message);
    if (Array.isArray(issues)) {
      const first = issues.find(
        issue => issue && typeof issue.message === "string"
      );
      if (first) return first.message;
    }
  } catch {
    // Non-Zod server errors already contain the user-facing message.
  }
  return message;
}
