/** สร้าง state เริ่มต้นของหน้า Settings จากข้อมูลที่ React Query cache ไว้แล้ว */
export function createInitialSettingsForm(
  settingMap: Readonly<Record<string, string>> | undefined
): Record<string, string> {
  return { ...(settingMap ?? {}) };
}

export const STAFF_PASSWORD_MIN_LENGTH = 10;
export const STAFF_PASSWORD_MAX_LENGTH = 128;

/**
 * Keep the staff password rules in one place so the Settings form can stop an
 * invalid request before tRPC serializes the Zod issues into a JSON message.
 */
export function staffPasswordValidationMessage(password: string): string | null {
  if (password.length < STAFF_PASSWORD_MIN_LENGTH) {
    return `รหัสผ่านต้องมีอย่างน้อย ${STAFF_PASSWORD_MIN_LENGTH} ตัวอักษร`;
  }
  if (password.length > STAFF_PASSWORD_MAX_LENGTH) {
    return `รหัสผ่านต้องไม่เกิน ${STAFF_PASSWORD_MAX_LENGTH} ตัวอักษร`;
  }
  if (
    !/[a-z]/.test(password) ||
    !/[A-Z]/.test(password) ||
    !/\d/.test(password)
  ) {
    return "รหัสผ่านต้องมีตัวพิมพ์เล็ก ตัวพิมพ์ใหญ่ และตัวเลข";
  }
  return null;
}

function errorMessage(error: unknown): string {
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return typeof error === "string" ? error : "บันทึกข้อมูลพนักงานไม่สำเร็จ";
}

/**
 * tRPC uses Zod's issue array as the input-validation error message. Never show
 * that implementation detail directly to staff; extract only the safe,
 * user-facing issue text.
 */
export function staffMutationErrorMessage(error: unknown): string {
  const message = errorMessage(error);
  try {
    const issues: unknown = JSON.parse(message);
    if (!Array.isArray(issues)) return message;
    const firstIssue = issues.find(
      issue =>
        issue &&
        typeof issue === "object" &&
        "message" in issue &&
        typeof issue.message === "string"
    );
    if (!firstIssue || typeof firstIssue !== "object") return message;

    const issue = firstIssue as {
      code?: unknown;
      message: string;
      path?: unknown;
    };
    const isPasswordIssue =
      Array.isArray(issue.path) && issue.path[0] === "password";
    if (isPasswordIssue && issue.code === "too_small") {
      return `รหัสผ่านต้องมีอย่างน้อย ${STAFF_PASSWORD_MIN_LENGTH} ตัวอักษร`;
    }
    if (isPasswordIssue && issue.code === "too_big") {
      return `รหัสผ่านต้องไม่เกิน ${STAFF_PASSWORD_MAX_LENGTH} ตัวอักษร`;
    }
    return issue.message;
  } catch {
    return message;
  }
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
