/** สร้าง state เริ่มต้นของหน้า Settings จากข้อมูลที่ React Query cache ไว้แล้ว */
export function createInitialSettingsForm(
  settingMap: Readonly<Record<string, string>> | undefined
): Record<string, string> {
  return { ...(settingMap ?? {}) };
}

export type EditableProductValues = {
  id?: number;
  code: string;
  name: string;
  category: "fuel" | "lubricant" | "other";
  unit: string;
  price: number;
  cost: number;
  stockQty: number;
  lowStockAt: number;
  active?: boolean;
};

export type ProductUpdatePatch = {
  id: number;
  code?: string;
  name?: string;
  category?: EditableProductValues["category"];
  unit?: string;
  price?: number;
  cost?: number;
  stockQty?: number;
  lowStockAt?: number;
  active?: boolean;
};

const PRODUCT_UPDATE_FIELDS = [
  "code",
  "name",
  "category",
  "unit",
  "price",
  "cost",
  "stockQty",
  "lowStockAt",
  "active",
] as const;

/**
 * updateProduct เป็น PATCH endpoint จึงควรส่งเฉพาะค่าที่ผู้ใช้แก้จริง
 * โดยเฉพาะ price เพื่อไม่ให้ค่าจากฟอร์มเก่าทับราคาที่เครื่องอื่น
 * เพิ่งบันทึกไปโดยผู้ใช้ไม่ได้ตั้งใจแก้ราคา
 */
export function createProductUpdatePatch(
  current: EditableProductValues,
  initial: EditableProductValues
): ProductUpdatePatch {
  if (current.id == null) {
    throw new Error("ไม่พบรหัสสินค้าที่ต้องการแก้ไข");
  }

  const patch: ProductUpdatePatch = { id: current.id };
  for (const field of PRODUCT_UPDATE_FIELDS) {
    if (current[field] !== initial[field]) {
      Object.assign(patch, { [field]: current[field] });
    }
  }
  return patch;
}
