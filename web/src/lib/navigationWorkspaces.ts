import {
  MENU_PERMISSION_DEFINITIONS,
  hasMenuPermission,
  type StaffRole,
} from "@contracts/menuPermissions";

export const POS_WORKSPACE_PATHS = ["/pos", "/shifts", "/sales"] as const;

export function isPosWorkspacePath(path: string): boolean {
  return POS_WORKSPACE_PATHS.some(
    route => path === route || path.startsWith(`${route}/`)
  );
}

export function getBusinessLandingPath(
  role: StaffRole,
  permissions: readonly string[] | null | undefined
): string | null {
  if (role === "cashier" && hasMenuPermission(role, permissions, "pos")) {
    return "/pos";
  }
  return (
    MENU_PERMISSION_DEFINITIONS.find(
      menu =>
        menu.key !== "platform" &&
        hasMenuPermission(role, permissions, menu.key)
    )?.path ?? null
  );
}
