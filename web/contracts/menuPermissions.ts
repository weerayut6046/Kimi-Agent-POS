export const STAFF_ROLES = ["admin", "manager", "cashier"] as const;

export type StaffRole = (typeof STAFF_ROLES)[number];
export type MenuPermissionGroup =
  "station" | "customer" | "document" | "system";

const ALL_ROLES = STAFF_ROLES;
const MANAGER_AND_ADMIN = ["admin", "manager"] as const;

/**
 * ทะเบียนสิทธิ์กลางของระบบ
 *
 * เมื่อเพิ่มโมดูลใหม่ ให้เพิ่มข้อมูลที่นี่เพียงจุดเดียว หน้าตั้งค่าสิทธิ์และ
 * ค่าเริ่มต้นตามบทบาทจะสร้างจากรายการนี้อัตโนมัติ ส่วน apiPrefixes ทำให้
 * procedure ใหม่ภายใต้ router เดิมรับสิทธิ์ของโมดูลนั้นทันที
 */
export const MENU_PERMISSION_DEFINITIONS = [
  {
    key: "dashboard",
    path: "/",
    label: "ภาพรวมสถานี",
    group: "station",
    roles: ALL_ROLES,
    apiPrefixes: [] as const,
  },
  {
    key: "pos",
    path: "/pos",
    label: "ขายหน้าลาน",
    group: "station",
    roles: ALL_ROLES,
    apiPrefixes: [] as const,
  },
  {
    key: "shifts",
    path: "/shifts",
    label: "จัดการกะ",
    group: "station",
    roles: ALL_ROLES,
    apiPrefixes: [] as const,
  },
  {
    key: "workforce",
    path: "/workforce",
    label: "พนักงานและตารางงาน",
    group: "station",
    roles: ALL_ROLES,
    apiPrefixes: ["workforce.", "attendance."] as const,
  },
  {
    key: "stock",
    path: "/stock",
    label: "สต๊อกและถัง",
    group: "station",
    roles: ALL_ROLES,
    apiPrefixes: ["stockCount."] as const,
  },
  {
    key: "members",
    path: "/members",
    label: "สมาชิก",
    group: "customer",
    roles: ALL_ROLES,
    apiPrefixes: ["membership."] as const,
  },
  {
    key: "customers",
    path: "/customers",
    label: "ลูกค้าธุรกิจ",
    group: "customer",
    roles: ALL_ROLES,
    apiPrefixes: ["customers."] as const,
  },
  {
    key: "debts",
    path: "/debts",
    label: "ลูกหนี้เครดิต",
    group: "customer",
    roles: ALL_ROLES,
    apiPrefixes: ["credit."] as const,
  },
  {
    key: "sales",
    path: "/sales",
    label: "ประวัติการขาย",
    group: "document",
    roles: ALL_ROLES,
    apiPrefixes: [] as const,
  },
  {
    key: "reports",
    path: "/reports",
    label: "รายงาน",
    group: "document",
    roles: ALL_ROLES,
    apiPrefixes: ["reports."] as const,
  },
  {
    key: "expenses",
    path: "/expenses",
    label: "ค่าใช้จ่าย",
    group: "document",
    roles: ALL_ROLES,
    apiPrefixes: ["expenses."] as const,
  },
  {
    key: "tax_invoices",
    path: "/tax-invoices",
    label: "ใบกำกับภาษี",
    group: "document",
    roles: ALL_ROLES,
    apiPrefixes: ["taxInvoice."] as const,
  },
  {
    key: "documents",
    path: "/documents",
    label: "เอกสาร",
    group: "document",
    roles: MANAGER_AND_ADMIN,
    apiPrefixes: [] as const,
  },
  {
    key: "audit",
    path: "/audit",
    label: "บันทึกการใช้งาน",
    group: "system",
    roles: ["admin"] as const,
    apiPrefixes: ["audit."] as const,
  },
  {
    key: "security",
    path: "/security",
    label: "ความปลอดภัย",
    group: "system",
    roles: ["admin"] as const,
    apiPrefixes: ["security."] as const,
  },
  {
    key: "settings",
    path: "/settings",
    label: "ตั้งค่าระบบ",
    group: "system",
    roles: ALL_ROLES,
    apiPrefixes: ["dbadmin."] as const,
  },
] as const;

export type MenuPermissionDefinition =
  (typeof MENU_PERMISSION_DEFINITIONS)[number];
export type MenuPermissionKey = MenuPermissionDefinition["key"];

// z.enum ต้องการ tuple ที่มีสมาชิกอย่างน้อยหนึ่งค่า จึงคงรูป tuple ไว้ที่ type
// ขณะที่ค่าจริงถูกสร้างจากทะเบียนกลางโดยอัตโนมัติ
export const MENU_PERMISSION_KEYS = MENU_PERMISSION_DEFINITIONS.map(
  definition => definition.key
) as [MenuPermissionKey, ...MenuPermissionKey[]];

export const MENU_PERMISSION_GROUP_LABELS: Record<MenuPermissionGroup, string> =
  {
    station: "งานหน้าสถานี",
    customer: "ลูกค้าและเครดิต",
    document: "เอกสารและรายงาน",
    system: "ระบบ",
  };

export function getRoleMenuPermissions(role: StaffRole): MenuPermissionKey[] {
  return MENU_PERMISSION_DEFINITIONS.filter(definition =>
    definition.roles.some(eligibleRole => eligibleRole === role)
  ).map(definition => definition.key);
}

export function isRoleEligibleForMenu(
  role: StaffRole,
  key: MenuPermissionKey
): boolean {
  return Boolean(
    MENU_PERMISSION_DEFINITIONS.find(
      definition =>
        definition.key === key &&
        definition.roles.some(eligibleRole => eligibleRole === role)
    )
  );
}

/**
 * คืนสิทธิ์เมนูที่ใช้ตรวจ procedure ฝั่ง API (อย่างน้อยหนึ่งสิทธิ์ผ่านได้)
 *
 * กติกาเฉพาะของ router ที่รวมหลายโมดูลอยู่ก่อนกติกาทั่วไปเสมอ ส่วน router
 * ที่ผูกกับโมดูลเดียวอ่าน apiPrefixes จากทะเบียนกลาง ทำให้ procedure ใหม่
 * ภายใต้ router นั้นถูกตรวจสิทธิ์โดยอัตโนมัติ
 */
export function getApiMenuPermissions(path: string): MenuPermissionKey[] {
  if (
    path.startsWith("pos.shift") ||
    path === "pos.openShift" ||
    path === "pos.closeShift"
  ) {
    return ["shifts"];
  }

  if (
    path === "pos.salesHistory" ||
    path === "pos.saleDetail" ||
    path === "pos.returnSale" ||
    path === "pos.updateSale" ||
    path === "pos.voidSale" ||
    path === "pos.deleteSale"
  ) {
    return ["sales"];
  }

  // สถานะกะปัจจุบันแสดงใน app shell ของทุกหน้าหลังเข้าสู่ระบบ
  if (path === "pos.currentShift") return [];
  if (path === "pos.dashboard") return ["dashboard"];
  if (path === "pos.createSale") return ["pos"];

  // procedure ใหม่ใน POS ใช้สิทธิ์ของหนึ่งในหน้าที่อ่านข้อมูล POS ได้ จนกว่า
  // จะมีการกำหนดกติกาที่ละเอียดกว่าไว้ด้านบน
  if (path.startsWith("pos.")) {
    return ["pos", "shifts", "sales", "dashboard"];
  }

  if (
    path === "catalog.searchExternalProduct" ||
    path === "catalog.importExternalProduct"
  ) {
    return ["pos"];
  }

  if (
    path === "catalog.updateBillPromotion" ||
    path === "catalog.updatePerLiterPromotion"
  ) {
    return ["settings"];
  }

  // ข้อมูลร้าน/โลโก้เป็นข้อมูลประกอบที่หลายหน้าต้องใช้ ไม่ผูกกับเมนูเดียว
  if (path === "catalog.getSettings" || path === "catalog.getShopLogo") {
    return [];
  }

  if (path === "catalog.listProducts") {
    return ["pos", "stock", "sales", "settings"];
  }

  if (path === "catalog.listPumps") return ["shifts", "settings"];
  if (path === "catalog.listTanks") {
    return ["stock", "reports", "settings"];
  }

  if (
    path === "catalog.lowStockAlerts" ||
    path === "catalog.refillTank" ||
    path === "catalog.listRefills" ||
    path === "catalog.addTankReading" ||
    path === "catalog.listTankReadings"
  ) {
    return ["stock"];
  }

  // catalog เป็น router จัดการข้อมูลหลัก ฟังก์ชันใหม่ที่ยังไม่ได้ระบุเป็น
  // กรณีใช้ร่วมกันจะถูกจำกัดไว้ที่หน้าตั้งค่าโดยอัตโนมัติ (fail closed)
  if (path.startsWith("catalog.")) return ["settings"];

  // งานรับชำระถูกเรียกได้จากหน้าขาย ประวัติการขาย และหน้าตั้งค่า
  if (path.startsWith("payments.")) {
    return ["pos", "sales", "settings"];
  }

  const permissions = MENU_PERMISSION_DEFINITIONS.filter(definition =>
    definition.apiPrefixes.some(prefix => path.startsWith(prefix))
  ).map(definition => definition.key);

  return [...new Set(permissions)];
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

  const allowedForRole = new Set(getRoleMenuPermissions(role));
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
