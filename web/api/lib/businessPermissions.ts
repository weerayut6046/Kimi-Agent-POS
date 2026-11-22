/**
 * Business action permissions for KY-FuelPOS.
 *
 * This is intentionally separate from navigation/menu permissions. A menu
 * being visible must never be sufficient authorization for a mutation.
 * Existing persisted role identifiers remain unchanged for compatibility.
 */
export type BusinessRole = "admin" | "manager" | "cashier";

export const BUSINESS_ACTIONS = [
  "cost.read",
  "cost.manage",
  "profit.read",
  "closing.approve",
  "closing.adjust.request",
  "closing.history.manage",
  "users.manage_staff",
  "audit.read",
  "audit.manage",
  "meter.create",
  "shift.submit",
  "shift.history.create",
] as const;

export type BusinessAction = (typeof BUSINESS_ACTIONS)[number];

const ROLE_ACTIONS: Readonly<Record<BusinessRole, readonly BusinessAction[]>> = {
  admin: BUSINESS_ACTIONS,
  manager: [
    "closing.approve",
    "closing.adjust.request",
    "users.manage_staff",
    "meter.create",
    "shift.submit",
  ],
  cashier: ["meter.create", "shift.submit"],
};

/**
 * A coarse-grained first gate. Resource ownership, branch membership,
 * record state and separation-of-duties must ALSO be checked by the caller.
 * Unknown roles/actions are denied even if untrusted runtime data is passed.
 */
export function canPerformBusinessAction(
  role: string | null | undefined,
  action: string
): boolean {
  if (!role || !Object.prototype.hasOwnProperty.call(ROLE_ACTIONS, role)) {
    return false;
  }
  return ROLE_ACTIONS[role as BusinessRole].includes(action as BusinessAction);
}

/** Owner is a UI label, not an additional persisted role. */
export const BUSINESS_ROLE_LABELS: Readonly<Record<BusinessRole, string>> = {
  admin: "Owner",
  manager: "Manager",
  cashier: "Staff",
};
