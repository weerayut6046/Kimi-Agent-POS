export const STAFF_ROLES = ["admin", "manager", "cashier"] as const;

export type StaffRole = (typeof STAFF_ROLES)[number];

export const MENU_PERMISSION_KEYS = [
  "dashboard",
  "pos",
  "shifts",
  "workforce",
  "stock",
  "members",
  "customers",
  "debts",
  "sales",
  "reports",
  "expenses",
  "tax_invoices",
  "documents",
  "audit",
  "settings",
] as const;

export type MenuPermissionKey = (typeof MENU_PERMISSION_KEYS)[number];
export type MenuPermissionGroup =
  "station" | "customer" | "document" | "system";

export type MenuPermissionDefinition = {
  key: MenuPermissionKey;
  path: string;
  label: string;
  group: MenuPermissionGroup;
};

export const MENU_PERMISSION_DEFINITIONS: readonly MenuPermissionDefinition[] =
  [
    { key: "dashboard", path: "/", label: "ภาพรวมสถานี", group: "station" },
    { key: "pos", path: "/pos", label: "ขายหน้าลาน", group: "station" },
    { key: "shifts", path: "/shifts", label: "จัดการกะ", group: "station" },
    {
      key: "workforce",
      path: "/workforce",
      label: "พนักงานและตารางงาน",
      group: "station",
    },
    { key: "stock", path: "/stock", label: "สต๊อกและถัง", group: "station" },
    { key: "members", path: "/members", label: "สมาชิก", group: "customer" },
    {
      key: "customers",
      path: "/customers",
      label: "ลูกค้าธุรกิจ",
      group: "customer",
    },
    { key: "debts", path: "/debts", label: "ลูกหนี้เครดิต", group: "customer" },
    { key: "sales", path: "/sales", label: "ประวัติการขาย", group: "document" },
    {
      key: "reports",
      path: "/reports",
      label: "รายงานปิดวัน",
      group: "document",
    },
    {
      key: "expenses",
      path: "/expenses",
      label: "ค่าใช้จ่าย",
      group: "document",
    },
    {
      key: "tax_invoices",
      path: "/tax-invoices",
      label: "ใบกำกับภาษี",
      group: "document",
    },
    {
      key: "documents",
      path: "/documents",
      label: "เอกสาร",
      group: "document",
    },
    { key: "audit", path: "/audit", label: "บันทึกการใช้งาน", group: "system" },
    {
      key: "settings",
      path: "/settings",
      label: "ตั้งค่าระบบ",
      group: "system",
    },
  ];

export const MENU_PERMISSION_GROUP_LABELS: Record<MenuPermissionGroup, string> =
  {
    station: "งานหน้าสถานี",
    customer: "ลูกค้าและเครดิต",
    document: "เอกสารและรายงาน",
    system: "ระบบ",
  };

const ROLE_MENU_KEYS: Record<StaffRole, readonly MenuPermissionKey[]> = {
  admin: MENU_PERMISSION_KEYS,
  manager: MENU_PERMISSION_KEYS.filter(key => key !== "audit"),
  cashier: MENU_PERMISSION_KEYS.filter(
    key => key !== "documents" && key !== "audit"
  ),
};

export function getRoleMenuPermissions(role: StaffRole): MenuPermissionKey[] {
  return [...ROLE_MENU_KEYS[role]];
}

export function isRoleEligibleForMenu(
  role: StaffRole,
  key: MenuPermissionKey
): boolean {
  return ROLE_MENU_KEYS[role].includes(key);
}

/**
 * ค่า null/undefined คือข้อมูลบัญชีรุ่นเดิม จึงคืนสิทธิ์เดิมตาม role เพื่อให้
 * migration ย้อนหลังไม่ทำให้ผู้ใช้สูญเสียเมนู ส่วน admin เห็นทุกเมนูเสมอ
 */
export function normalizeMenuPermissions(
  role: StaffRole,
  stored: readonly string[] | null | undefined
): MenuPermissionKey[] {
  if (role === "admin" || stored == null) return getRoleMenuPermissions(role);

  const allowedForRole = new Set(ROLE_MENU_KEYS[role]);
  const storedSet = new Set(stored);
  return MENU_PERMISSION_KEYS.filter(
    key => allowedForRole.has(key) && storedSet.has(key)
  );
}

export function hasMenuPermission(
  role: StaffRole,
  stored: readonly string[] | null | undefined,
  key: MenuPermissionKey
): boolean {
  return normalizeMenuPermissions(role, stored).includes(key);
}

export function getFirstAllowedMenuPath(
  role: StaffRole,
  stored: readonly string[] | null | undefined
): string | null {
  const firstKey = normalizeMenuPermissions(role, stored)[0];
  return (
    MENU_PERMISSION_DEFINITIONS.find(item => item.key === firstKey)?.path ??
    null
  );
}
